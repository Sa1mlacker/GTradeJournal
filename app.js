// G Trade Journal - Main Application

(function() {
    'use strict';

    // Version for cache busting - UPDATE THIS when making changes
    const APP_VERSION = '1.0.7';
    console.log('G Trade Journal v' + APP_VERSION);

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
        // Safety timeout - hide loading screen after 15 seconds regardless
        const safetyTimeout = setTimeout(() => {
            console.log('Safety timeout reached, hiding loading screen');
            hideLoading();
            showAuth(); // Show login screen as fallback
        }, 15000);

        // Register service worker
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('/sw.js?v=1.0.7')
                .then((registration) => {
                    console.log('ServiceWorker registered:', registration.scope);
                })
                .catch((error) => {
                    console.log('ServiceWorker registration failed:', error);
                });
        }

        // Prevent back navigation cache issues
        window.addEventListener('pageshow', function(event) {
            if (event.persisted) {
                // Page was loaded from back/forward cache
                console.log('Page loaded from back/forward cache, refreshing...');
                window.location.reload();
            }
        });

        if (!checkSharedView()) {
            setupEventListeners();
            checkSession().finally(() => {
                clearTimeout(safetyTimeout);
            });
        } else {
            clearTimeout(safetyTimeout);
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
            // Add timeout for session check
            const timeoutPromise = new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Session check timeout')), 10000)
            );
            
            const sessionPromise = db.auth.getSession();
            const { data: { session } } = await Promise.race([sessionPromise, timeoutPromise]);
            
            if (session) {
                currentUser = session.user;
                showApp();
                loadTrades();
            } else {
                showAuth();
            }
        } catch (err) {
            console.error('Session check error:', err);
            // Still show auth even on error
            showAuth();
        }
    }

    function hideLoading() {
        if (loadingScreen) {
            loadingScreen.style.display = 'none';
            loadingScreen.remove(); // Remove from DOM to prevent any issues
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
            if (el) {
                el.addEventListener('input', updateAutoPL);
                el.addEventListener('change', updateAutoPL);
            }
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
            window.cancelEditForm();
            hideEquityChart();
            closeShareModal();
        }
    }

    // ==================== Authentication ====================

    db.auth.onAuthStateChange(async (event, session) => {
        // Always hide loading screen first
        hideLoading();
        
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
            authTitle.textContent = "Sign In to G Trade Journal";
            authPrimaryBtn.textContent = "Sign In";
            authSecondaryBtn.textContent = "Sign Up";
        } else {
            authTitle.textContent = "Sign Up";
            authPrimaryBtn.textContent = "Create Account";
            authSecondaryBtn.textContent = "Already have an account? Sign In";
        }
    }

    async function handleAuth() {
        const email = authEmail.value.trim();
        const password = authPassword.value;

        if (!email) {
            showAuthError("Enter email");
            return;
        }
        if (!password) {
            showAuthError("Enter password");
            return;
        }
        if (password.length < 6) {
            showAuthError("Password must be at least 6 characters");
            return;
        }

        authPrimaryBtn.disabled = true;

        try {
            if (isLoginMode) {
                showAuthInfo("Signing in...");
                const { data, error } = await db.auth.signInWithPassword({
                    email: email,
                    password: password
                });
                if (error) throw error;
                showAuthSuccess("Signed in successfully!");
            } else {
                showAuthInfo("Creating account...");
                const { data, error } = await db.auth.signUp({
                    email: email,
                    password: password
                });
                if (error) throw error;

                if (data.user && !data.session) {
                    showAuthSuccess("Account created! Check your email to confirm.");
                } else {
                    showAuthSuccess("Account created!");
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
        // Clear any cached session data
        sessionStorage.clear();
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
            "Invalid login credentials": "Invalid email or password",
            "Email not confirmed": "Email not confirmed",
            "User already registered": "User already registered",
            "Password should be at least 6 characters": "Password must be at least 6 characters",
            "Unable to validate email address: invalid format": "Invalid email format",
            "Failed to fetch": "Network error. Please check your internet connection."
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

    // Retry helper function
    async function withRetry(fn, maxRetries = 3, delay = 1000) {
        let lastError;
        for (let i = 0; i < maxRetries; i++) {
            try {
                return await fn();
            } catch (err) {
                lastError = err;
                console.warn(`Attempt ${i + 1} failed:`, err.message);
                if (i < maxRetries - 1) {
                    await new Promise(resolve => setTimeout(resolve, delay * (i + 1)));
                }
            }
        }
        throw lastError;
    }

    async function loadTrades() {
        if (!currentUser) return;

        try {
            const { data, error } = await withRetry(() => 
                db
                    .from('trades')
                    .select('*')
                    .eq('user_id', currentUser.id)
                    .order('date', { ascending: false })
            );

            if (error) throw error;

            trades = data || [];
            renderTrades();
        } catch (err) {
            console.error('Load trades error:', err);
            showTradesError('Помилка завантаження даних. Спробуйте оновити сторінку.');
        }
    }

    async function loadSharedTrades(userId) {
        try {
            // Check if user has public sharing enabled
            const { data: profileData, error: profileError } = await withRetry(() =>
                db
                    .from('user_profiles')
                    .select('is_public')
                    .eq('user_id', userId)
                    .single()
            );

            if (profileError || !profileData || !profileData.is_public) {
                showTradesError('Цей журнал не є публічним');
                return;
            }

            const { data, error } = await withRetry(() =>
                db
                    .from('trades')
                    .select('*')
                    .eq('user_id', userId)
                    .order('date', { ascending: false })
            );

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
        if (!tbody) return;
        
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
                <td class="actions-cell">${isViewOnly ? '' : `<button class="edit-btn" data-id="${trade.id}">✎</button><button class="delete-btn" data-id="${trade.id}">✕</button>`}</td>
            `;

            // Attach event listeners immediately after creating the element
            if (!isViewOnly) {
                const editBtn = tr.querySelector('.edit-btn');
                const deleteBtn = tr.querySelector('.delete-btn');
                
                if (editBtn) {
                    editBtn.addEventListener('click', function(e) {
                        e.stopPropagation();
                        window.openEditForm(trade);
                    });
                }
                
                if (deleteBtn) {
                    deleteBtn.addEventListener('click', function(e) {
                        e.stopPropagation();
                        window.deleteTrade(trade.id);
                    });
                }
            }

            tbody.appendChild(tr);
        });

        updateStats(equity);
        updateChart(equityData);
    }

    function showTradesError(message) {
        const tbody = document.getElementById('tradesBody');
        if (!tbody) return;
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

        const totalTradesEl = document.getElementById('totalTrades');
        const winrateEl = document.getElementById('winrate');
        const avgRiskEl = document.getElementById('avgRisk');
        const avgRREl = document.getElementById('avgRR');
        const totalReturnEl = document.getElementById('totalReturn');

        if (totalTradesEl) totalTradesEl.textContent = total;
        if (winrateEl) winrateEl.textContent = winrate;
        if (avgRiskEl) avgRiskEl.textContent = avgRisk;
        if (avgRREl) avgRREl.textContent = avgRR;
        if (totalReturnEl) totalReturnEl.textContent = equity.toFixed(2) + '%';
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
            const { data, error } = await withRetry(() => db.from('trades').insert(trade));
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

    // ==================== Edit Trade ====================

    let editingTradeId = null;

    window.openEditForm = function(trade) {
        if (isViewOnly || !currentUser) return;
        
        editingTradeId = trade.id;
        
        document.getElementById('editPair').value = trade.asset || '';
        document.getElementById('editDate').value = trade.date || '';
        document.getElementById('editSession').value = trade.session || 'London';
        document.getElementById('editDirection').value = trade.direction || 'Long';
        document.getElementById('editSetup').value = trade.setup || '';
        document.getElementById('editTradingView').value = trade.tradingview_url || '';
        
        const riskValue = trade.risk ? trade.risk.replace('%', '') : '';
        document.getElementById('editRisk').value = riskValue;
        document.getElementById('editRR').value = trade.rr || '';
        document.getElementById('editResult').value = trade.result || '';
        document.getElementById('editPL').value = trade.pl || '';
        
        document.getElementById('editFormOverlay').classList.add('active');
        setupEditFormListeners();
    }

    function setupEditFormListeners() {
        const riskInput = document.getElementById('editRisk');
        const rrInput = document.getElementById('editRR');
        const resultInput = document.getElementById('editResult');
        const plInput = document.getElementById('editPL');
        
        if (!riskInput || !rrInput || !resultInput || !plInput) return;
        
        const updateEditPL = () => {
            const risk = riskInput.value.trim();
            const rr = rrInput.value.trim();
            const result = resultInput.value;
            plInput.value = calculatePL(risk, rr, result);
        };
        
        riskInput.removeEventListener('change', updateEditPL);
        rrInput.removeEventListener('change', updateEditPL);
        resultInput.removeEventListener('change', updateEditPL);
        
        riskInput.addEventListener('change', updateEditPL);
        rrInput.addEventListener('change', updateEditPL);
        resultInput.addEventListener('change', updateEditPL);
    }

    window.cancelEditForm = function() {
        document.getElementById('editFormOverlay').classList.remove('active');
        editingTradeId = null;
    }

    window.saveEditTrade = async function() {
        if (isViewOnly || !currentUser || !editingTradeId) {
            alert('Помилка: Немає активного користувача');
            return;
        }

        const pair = document.getElementById('editPair').value.trim() || 'XAUUSD';
        const date = document.getElementById('editDate').value;

        if (!date) {
            alert('Виберіть дату');
            return;
        }

        const risk = document.getElementById('editRisk').value.trim();
        const rr = document.getElementById('editRR').value.trim();
        const result = document.getElementById('editResult').value;

        if (!risk) {
            alert('Введіть Risk %');
            return;
        }
        if (!result) {
            alert('Виберіть Result');
            return;
        }

        const pl = calculatePL(risk, rr, result);

        const updatedTrade = {
            asset: pair.toUpperCase(),
            date: date,
            session: document.getElementById('editSession').value,
            direction: document.getElementById('editDirection').value,
            setup: document.getElementById('editSetup').value.trim(),
            tradingview_url: document.getElementById('editTradingView').value.trim(),
            risk: risk + '%',
            rr: rr,
            pl: pl,
            result: result
        };

        console.log('Оновлюємо трейд:', updatedTrade);

        try {
            const { data, error } = await withRetry(() => 
                db.from('trades').update(updatedTrade).eq('id', editingTradeId)
            );
            if (error) {
                console.error('Supabase error details:', error);
                throw error;
            }

            console.log('Трейд успішно оновлено:', data);
            window.cancelEditForm();
            loadTrades();
        } catch (err) {
            console.error('Update trade error:', err);

            let errorMsg = 'Помилка при оновленні трейду';
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
            const { error } = await withRetry(() => db.from('trades').delete().eq('id', id));
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
        const ctx = document.getElementById('equityChart');
        if (!ctx) return;
        
        const ctx2d = ctx.getContext('2d');
        if (!ctx2d) return;
        
        if (chart) chart.destroy();

        try {
            chart = new Chart(ctx2d, {
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
        } catch (err) {
            console.error('Chart error:', err);
        }
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
            const { data, error } = await withRetry(() =>
                db
                    .from('user_profiles')
                    .select('is_public')
                    .eq('user_id', currentUser.id)
                    .single()
            );

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
            const { error } = await withRetry(() =>
                db
                    .from('user_profiles')
                    .upsert({
                        user_id: currentUser.id,
                        is_public: !isActive
                    }, {
                        onConflict: 'user_id'
                    })
            );

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
        const linkEl = document.getElementById('shareLink');
        if (!linkEl) return;
        
        const link = linkEl.textContent;
        navigator.clipboard.writeText(link).then(() => {
            const original = linkEl.textContent;
            linkEl.textContent = '✓ Скопійовано!';
            setTimeout(() => {
                linkEl.textContent = original;
            }, 2000);
        }).catch(err => {
            console.error('Copy failed:', err);
            alert('Не вдалося скопіювати посилання');
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
        const localTrades = JSON.parse(localStorage.getItem('gTradeJournalEquity') || '[]');
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
        if (text === null || text === undefined) return '';
        const div = document.createElement('div');
        div.textContent = String(text);
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

