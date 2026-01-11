// G Trade Journal - Main Application

(function() {
    'use strict';

    // Supabase Configuration (з config.js)
    if (!window.CONFIG) {
        console.error('CONFIG не завантажено! Перевірте config.js');
        alert('Помилка конфігурації. Перевірте файл config.js');
        throw new Error('CONFIG not loaded');
    }

    const SUPABASE_URL = window.CONFIG.SUPABASE_URL;
    const SUPABASE_ANON_KEY = window.CONFIG.SUPABASE_ANON_KEY;

    console.log('Supabase URL:', SUPABASE_URL);

    if (!window.supabase) {
        console.error('Supabase library не завантажено!');
        alert('Помилка: Supabase library не завантажено');
        throw new Error('Supabase library not loaded');
    }

    const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    // Application State
    let trades = [];
    let chart = null;
    let isLoginMode = true;
    let currentUser = null;
    let isViewOnly = false;
    let viewUserId = null;

    // DOM Elements
    const loadingScreen = document.getElementById('loadingScreen');
    const authOverlay = document.getElementById('authOverlay');
    const authEmail = document.getElementById('authEmail');
    const authPassword = document.getElementById('authPassword');
    const authMsg = document.getElementById('authMsg');
    const authTitle = document.getElementById('authTitle');
    const authPrimaryBtn = document.getElementById('authPrimaryBtn');
    const authSecondaryBtn = document.getElementById('authSecondaryBtn');
    const app = document.getElementById('app');
    const viewOnlyBanner = document.getElementById('viewOnlyBanner');

    // ==================== Initialization ====================

    function init() {
        if (!checkSharedView()) {
            setupEventListeners();
            checkSession();
        }
    }

    function checkSharedView() {
        const urlParams = new URLSearchParams(window.location.search);
        const userId = urlParams.get('user');

        if (userId) {
            isViewOnly = true;
            viewUserId = userId;
            hideLoading();
            authOverlay.style.display = 'none';
            authOverlay.classList.add('hidden');
            app.style.display = 'block';
            viewOnlyBanner.classList.remove('hidden');

            // Show only equity chart button in view-only mode
            document.getElementById('headerButtons').innerHTML =
                '<button class="btn" id="equityBtn">Equity Curve</button>';
            document.getElementById('equityBtn').addEventListener('click', showEquityChart);

            loadSharedTrades(userId);
            return true;
        }
        return false;
    }

    async function checkSession() {
        try {
            const { data: { session } } = await db.auth.getSession();
            if (session) {
                currentUser = session.user;
                showApp();
                loadTrades();
            } else {
                showAuth();
            }
        } catch (err) {
            console.error('Session check error:', err);
            showAuth();
        }
    }

    function hideLoading() {
        if (loadingScreen) {
            loadingScreen.style.display = 'none';
        }
    }

    function showApp() {
        hideLoading();
        authOverlay.style.display = 'none';
        authOverlay.classList.add('hidden');
        app.style.display = 'block';
    }

    function showAuth() {
        hideLoading();
        authOverlay.style.display = 'flex';
        authOverlay.classList.remove('hidden');
        app.style.display = 'none';
    }

    // ==================== Event Listeners ====================

    function setupEventListeners() {
        authPrimaryBtn.addEventListener('click', handleAuth);
        authSecondaryBtn.addEventListener('click', toggleAuthForm);
        document.getElementById('logoutBtn').addEventListener('click', logout);
        document.getElementById('newTradeBtn').addEventListener('click', showForm);
        document.getElementById('equityBtn').addEventListener('click', showEquityChart);
        document.getElementById('shareBtn').addEventListener('click', showShareModal);
        document.getElementById('shareToggle').addEventListener('click', toggleShare);

        // Auto-calculate P/L
        ['newRisk', 'newRR', 'newResult'].forEach(id => {
            const el = document.getElementById(id);
            el.addEventListener('input', updateAutoPL);
            el.addEventListener('change', updateAutoPL);
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', handleKeyboard);
    }

    function handleKeyboard(e) {
        if (e.key === 'Enter' && !authOverlay.classList.contains('hidden')) {
            handleAuth();
        }
        if (e.key === 'Escape') {
            hideForm();
            hideEquityChart();
            closeShareModal();
        }
    }

    // ==================== Authentication ====================

    db.auth.onAuthStateChange(async (event, session) => {
        if (session && !isViewOnly) {
            currentUser = session.user;

            // Створити профіль якщо його немає (для нових користувачів)
            if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') {
                await ensureUserProfile();
            }

            showApp();
            loadTrades();
            checkAndMigrateLocalData();
        } else if (!isViewOnly) {
            showAuth();
        }
    });

    function toggleAuthForm() {
        isLoginMode = !isLoginMode;
        authMsg.textContent = "";

        if (isLoginMode) {
            authTitle.textContent = "Вхід в G Trade Journal";
            authPrimaryBtn.textContent = "Увійти";
            authSecondaryBtn.textContent = "Реєстрація";
        } else {
            authTitle.textContent = "Реєстрація";
            authPrimaryBtn.textContent = "Створити акаунт";
            authSecondaryBtn.textContent = "Вже є акаунт? Увійти";
        }
    }

    async function handleAuth() {
        const email = authEmail.value.trim();
        const password = authPassword.value;

        if (!email) {
            showAuthError("Введіть email");
            return;
        }
        if (!password) {
            showAuthError("Введіть пароль");
            return;
        }
        if (password.length < 6) {
            showAuthError("Пароль має бути не менше 6 символів");
            return;
        }

        authPrimaryBtn.disabled = true;

        try {
            if (isLoginMode) {
                showAuthInfo("Виконується вхід...");
                const { data, error } = await db.auth.signInWithPassword({
                    email: email,
                    password: password
                });
                if (error) throw error;
                showAuthSuccess("Успішний вхід!");
            } else {
                showAuthInfo("Створення акаунта...");
                const { data, error } = await db.auth.signUp({
                    email: email,
                    password: password
                });
                if (error) throw error;

                if (data.user && !data.session) {
                    showAuthSuccess("Акаунт створено! Перевірте пошту для підтвердження.");
                } else {
                    showAuthSuccess("Акаунт створено!");
                }
            }
        } catch (error) {
            console.error("Auth error:", error);
            showAuthError(translateError(error.message));
        } finally {
            authPrimaryBtn.disabled = false;
        }
    }

    async function logout() {
        await db.auth.signOut();
        window.location.reload();
    }

    function showAuthError(msg) {
        authMsg.textContent = msg;
        authMsg.className = 'auth-msg error';
    }

    function showAuthSuccess(msg) {
        authMsg.textContent = msg;
        authMsg.className = 'auth-msg success';
    }

    function showAuthInfo(msg) {
        authMsg.textContent = msg;
        authMsg.className = 'auth-msg info';
    }

    function translateError(msg) {
        const translations = {
            "Invalid login credentials": "Невірний email або пароль",
            "Email not confirmed": "Email не підтверджено",
            "User already registered": "Користувач вже зареєстрований",
            "Password should be at least 6 characters": "Пароль має бути не менше 6 символів",
            "Unable to validate email address: invalid format": "Невірний формат email",
            "Failed to fetch": "Помилка мережі. Перевірте підключення до інтернету."
        };
        return translations[msg] || msg;
    }

    // ==================== User Profile ====================

    async function ensureUserProfile() {
        if (!currentUser) return;

        try {
            // Перевірити чи є профіль
            const { data: existingProfile } = await db
                .from('user_profiles')
                .select('*')
                .eq('user_id', currentUser.id)
                .single();

            // Якщо профілю немає - створити
            if (!existingProfile) {
                const { error } = await db
                    .from('user_profiles')
                    .insert({
                        user_id: currentUser.id,
                        is_public: false
                    });

                if (error) {
                    console.error('Error creating user profile:', error);
                }
            }
        } catch (err) {
            console.error('Error ensuring user profile:', err);
        }
    }

    // ==================== Trades Management ====================

    async function loadTrades() {
        if (!currentUser) return;

        try {
            const { data, error } = await db
                .from('trades')
                .select('*')
                .eq('user_id', currentUser.id)
                .order('date', { ascending: false });

            if (error) throw error;

            trades = data || [];
            renderTrades();
        } catch (err) {
            console.error('Load trades error:', err);
            showTradesError('Помилка завантаження даних');
        }
    }

    async function loadSharedTrades(userId) {
        try {
            // Check if user has public sharing enabled
            const { data: profileData, error: profileError } = await db
                .from('user_profiles')
                .select('is_public')
                .eq('user_id', userId)
                .single();

            if (profileError || !profileData || !profileData.is_public) {
                showTradesError('Цей журнал не є публічним');
                return;
            }

            const { data, error } = await db
                .from('trades')
                .select('*')
                .eq('user_id', userId)
                .order('date', { ascending: false });

            if (error) throw error;

            trades = data || [];
            renderTrades();
        } catch (err) {
            console.error('Load shared trades error:', err);
            showTradesError('Помилка завантаження даних');
        }
    }

    function renderTrades() {
        const tbody = document.getElementById('tradesBody');
        tbody.innerHTML = '';

        if (trades.length === 0) {
            tbody.innerHTML = '<tr><td colspan="11" style="text-align: center; color: #666; padding: 40px;">Немає записів про трейди</td></tr>';
            updateStats(0);
            return;
        }

        let equity = 0;
        const equityData = [0];

        trades.forEach((trade) => {
            const plValue = trade.pl ? parseFloat(trade.pl) : 0;
            equity += plValue;
            equityData.push(equity);

            const plClass = plValue > 0 ? 'pl-positive' : plValue < 0 ? 'pl-negative' : 'pl-zero';
            const resultText = trade.result || '—';
            const resultClass = trade.result === 'Take' ? 'win-take' :
                               trade.result === 'Stop' ? 'win-stop' :
                               trade.result === 'BE' ? 'win-be' : '';

            const sessionClass = {
                'Asia': 'asia',
                'Frankfurt': 'frankfurt',
                'London': 'london',
                'New York': 'ny'
            }[trade.session] || 'london';

            const tr = document.createElement('tr');
            const tvHtml = trade.tradingview_url ? 
                `<a href="${escapeHtml(trade.tradingview_url)}" target="_blank" class="tv-link">TradingView</a>` : 
                '—';
            tr.innerHTML = `
                <td><span class="pair">${escapeHtml(trade.asset)}</span></td>
                <td class="date">${formatDate(trade.date)}</td>
                <td><span class="badge badge-${sessionClass}">${escapeHtml(trade.session)}</span></td>
                <td><span class="badge badge-${trade.direction.toLowerCase()}">${escapeHtml(trade.direction)}</span></td>
                <td>${escapeHtml(trade.setup || '—')}</td>
                <td>${tvHtml}</td>
                <td>${escapeHtml(trade.risk || '—')}</td>
                <td>${escapeHtml(trade.rr || '—')}</td>
                <td class="${plClass}">${escapeHtml(trade.pl || '—')}</td>
                <td class="${resultClass}">${escapeHtml(resultText)}</td>
                <td>${isViewOnly ? '' : `<button class="delete-btn" data-id="${trade.id}">✕</button>`}</td>
            `;

            if (!isViewOnly) {
                const deleteBtn = tr.querySelector('.delete-btn');
                deleteBtn.addEventListener('click', () => deleteTrade(trade.id));
            }

            tbody.appendChild(tr);
        });

        updateStats(equity);
        updateChart(equityData);
    }

    function showTradesError(message) {
        const tbody = document.getElementById('tradesBody');
        tbody.innerHTML = `<tr><td colspan="11" style="text-align: center; color: #666;">${escapeHtml(message)}</td></tr>`;
    }

    function updateStats(equity) {
        const total = trades.length;
        const wins = trades.filter(t => t.result === 'Take').length;
        const winrate = total > 0 ? ((wins / total) * 100).toFixed(1) + '%' : '—';

        const risks = trades.map(t => parseFloat(t.risk)).filter(v => !isNaN(v));
        const avgRisk = risks.length > 0 ? (risks.reduce((a,b) => a+b, 0) / risks.length).toFixed(2) + '%' : '—';

        const rrs = trades.map(t => parseFloat(t.rr)).filter(v => !isNaN(v));
        const avgRR = rrs.length > 0 ? (rrs.reduce((a,b) => a+b, 0) / rrs.length).toFixed(2) : '—';

        document.getElementById('totalTrades').textContent = total;
        document.getElementById('winrate').textContent = winrate;
        document.getElementById('avgRisk').textContent = avgRisk;
        document.getElementById('avgRR').textContent = avgRR;
        document.getElementById('totalReturn').textContent = equity.toFixed(2) + '%';
    }

    // ==================== Trade Form ====================

    function calculatePL(riskPercent, rr, result) {
        if (!riskPercent || !result) return '—';
        riskPercent = parseFloat(riskPercent);

        if (result === 'Take' && rr) {
            return (riskPercent * parseFloat(rr)).toFixed(2) + '%';
        } else if (result === 'Stop') {
            return '-' + riskPercent.toFixed(2) + '%';
        } else if (result === 'BE') {
            return '0%';
        }
        return '—';
    }

    function updateAutoPL() {
        const risk = document.getElementById('newRisk').value;
        const rr = document.getElementById('newRR').value;
        const result = document.getElementById('newResult').value;
        const pl = calculatePL(risk, rr, result);
        document.getElementById('newPL').value = pl;
    }

    window.showForm = function() {
        if (isViewOnly) return;
        document.getElementById('addFormOverlay').classList.add('active');
        document.getElementById('newDate').value = new Date().toISOString().split('T')[0];
        document.getElementById('newTradingView').value = '';
        updateAutoPL();
    }

    window.hideForm = function() {
        document.getElementById('addFormOverlay').classList.remove('active');
    }

    window.cancelForm = window.hideForm;

    window.addTrade = async function() {
        if (isViewOnly || !currentUser) {
            alert('Помилка: Немає активного користувача');
            return;
        }

        const pair = document.getElementById('newPair').value.trim() || 'XAUUSD';
        const date = document.getElementById('newDate').value;

        if (!date) {
            alert('Виберіть дату');
            return;
        }

        const risk = document.getElementById('newRisk').value.trim();
        const rr = document.getElementById('newRR').value.trim();
        const result = document.getElementById('newResult').value;

        if (!risk) {
            alert('Введіть Risk %');
            return;
        }
        if (!result) {
            alert('Виберіть Result');
            return;
        }

        const pl = calculatePL(risk, rr, result);

        const trade = {
            user_id: currentUser.id,
            asset: pair.toUpperCase(),
            date: date,
            session: document.getElementById('newSession').value,
            direction: document.getElementById('newDirection').value,
            setup: document.getElementById('newSetup').value.trim(),
            tradingview_url: document.getElementById('newTradingView').value.trim(),
            risk: risk + '%',
            rr: rr,
            pl: pl,
            result: result
        };

        console.log('Додаємо трейд:', trade);

        try {
            const { data, error } = await db.from('trades').insert(trade);
            if (error) {
                console.error('Supabase error details:', error);
                throw error;
            }

            console.log('Трейд успішно додано:', data);
            hideForm();
            loadTrades();
        } catch (err) {
            console.error('Add trade error:', err);

            // Детальніше про помилку
            let errorMsg = 'Помилка при додаванні трейду';
            if (err.message) {
                errorMsg += ': ' + err.message;
            }
            if (err.code) {
                errorMsg += ' (код: ' + err.code + ')';
            }

            alert(errorMsg);
        }
    }

    window.deleteTrade = async function(id) {
        if (isViewOnly || !currentUser) return;
        window.pendingDeleteId = id;
        document.getElementById('deleteConfirmOverlay').classList.remove('hidden');
    }

    window.confirmDelete = async function() {
        const id = window.pendingDeleteId;
        if (!id) return;

        document.getElementById('deleteConfirmOverlay').classList.add('hidden');

        try {
            const { error } = await db.from('trades').delete().eq('id', id);
            if (error) throw error;
            loadTrades();
        } catch (err) {
            console.error('Delete error:', err);
            alert('Помилка при видаленні трейду');
        }
    }

    window.cancelDelete = function() {
        document.getElementById('deleteConfirmOverlay').classList.add('hidden');
        window.pendingDeleteId = null;
    }

    // ==================== Equity Chart ====================

    function updateChart(equityData) {
        const ctx = document.getElementById('equityChart').getContext('2d');
        if (chart) chart.destroy();

        chart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: ['Start', ...trades.map((_, i) => `Trade ${i+1}`)],
                datasets: [{
                    label: 'Equity Curve (%)',
                    data: equityData,
                    borderColor: '#0066ff',
                    backgroundColor: 'rgba(0,102,255,0.15)',
                    fill: true,
                    tension: 0.3,
                    pointBackgroundColor: '#0066ff',
                    pointRadius: 5,
                    pointHoverRadius: 8
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    title: {
                        display: true,
                        text: 'Equity Curve',
                        color: '#ccc',
                        font: { size: 20 }
                    }
                },
                scales: {
                    y: {
                        grid: { color: '#222' },
                        ticks: { color: '#aaa' },
                        title: {
                            display: true,
                            text: 'Return %',
                            color: '#aaa'
                        }
                    },
                    x: {
                        grid: { color: '#222' },
                        ticks: { color: '#aaa' }
                    }
                }
            }
        });
    }

    window.showEquityChart = function() {
        document.getElementById('equityOverlay').classList.add('active');
    }

    window.hideEquityChart = function() {
        document.getElementById('equityOverlay').classList.remove('active');
    }

    // ==================== Share Functionality ====================

    async function loadShareSettings() {
        if (!currentUser) return;

        try {
            const { data, error } = await db
                .from('user_profiles')
                .select('is_public')
                .eq('user_id', currentUser.id)
                .single();

            if (error && error.code !== 'PGRST116') throw error;

            if (data && data.is_public) {
                document.getElementById('shareToggle').classList.add('active');
                document.getElementById('shareLinkContainer').classList.remove('hidden');
                updateShareLink();
            }
        } catch (err) {
            console.error('Load share settings error:', err);
        }
    }

    async function toggleShare() {
        if (!currentUser) return;

        const toggle = document.getElementById('shareToggle');
        const isActive = toggle.classList.contains('active');

        try {
            const { error } = await db
                .from('user_profiles')
                .upsert({
                    user_id: currentUser.id,
                    is_public: !isActive
                }, {
                    onConflict: 'user_id'
                });

            if (error) throw error;

            toggle.classList.toggle('active');
            const linkContainer = document.getElementById('shareLinkContainer');

            if (!isActive) {
                linkContainer.classList.remove('hidden');
                updateShareLink();
            } else {
                linkContainer.classList.add('hidden');
            }
        } catch (err) {
            console.error('Toggle share error:', err);
            alert('Помилка при зміні налаштувань');
        }
    }

    function updateShareLink() {
        if (!currentUser) return;
        const link = `${window.location.origin}${window.location.pathname}?user=${currentUser.id}`;
        document.getElementById('shareLink').textContent = link;
    }

    window.copyShareLink = function() {
        const link = document.getElementById('shareLink').textContent;
        navigator.clipboard.writeText(link).then(() => {
            const original = document.getElementById('shareLink').textContent;
            document.getElementById('shareLink').textContent = '✓ Скопійовано!';
            setTimeout(() => {
                document.getElementById('shareLink').textContent = original;
            }, 2000);
        });
    }

    window.showShareModal = function() {
        if (isViewOnly) return;
        document.getElementById('shareOverlay').classList.add('active');
        loadShareSettings();
    }

    window.closeShareModal = function() {
        document.getElementById('shareOverlay').classList.remove('active');
    }

    // ==================== Data Migration ====================

    async function checkAndMigrateLocalData() {
        const localTrades = JSON.parse(localStorage.getItem('gTradeJournalEquity')) || [];
        if (localTrades.length === 0) return;

        if (!confirm(`Знайдено ${localTrades.length} трейдів у локальному сховищі. Імпортувати їх?`)) {
            localStorage.removeItem('gTradeJournalEquity');
            return;
        }

        try {
            for (const trade of localTrades) {
                await db.from('trades').insert({
                    user_id: currentUser.id,
                    asset: trade.pair,
                    date: trade.date,
                    session: trade.session,
                    direction: trade.direction,
                    setup: trade.setup,
                    risk: trade.risk,
                    rr: trade.rr,
                    pl: trade.pl,
                    result: trade.result
                });
            }

            localStorage.removeItem('gTradeJournalEquity');
            alert('Дані успішно імпортовано!');
            loadTrades();
        } catch (err) {
            console.error('Migration error:', err);
            alert('Помилка при імпорті даних');
        }
    }

    // ==================== Utilities ====================

    function formatDate(dateStr) {
        if (!dateStr) return '—';
        const date = new Date(dateStr);
        return date.toLocaleDateString('en-GB', {
            day: 'numeric',
            month: 'short',
            year: 'numeric'
        });
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // ==================== Initialize Application ====================

    // Wait for DOM to be ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
