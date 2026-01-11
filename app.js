// G Trade Journal - Pure Fetch API Version (No Supabase SDK needed!)
// Version: 2.0.0 - Works with GitHub Pages CSP

(function() {
    'use strict';

    // Version for cache busting
    const APP_VERSION = '2.0.0';
    console.log('G Trade Journal v' + APP_VERSION + ' (Pure Fetch API)');

    // Supabase Configuration
    const SUPABASE_URL = 'https://ixnjbdvabaanyvnakwue.supabase.co';
    const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml4bmpiZHZhYmFhbnl2bmFrd3VlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjgxMjU2NjksImV4cCI6MjA4MzcwMTY2OX0.XVbat9-rhmkGW7D_8t9d-cqpz95orsqzgbakWUXvQGE';

    // Application State
    let trades = [];
    let chart = null;
    let isLoginMode = true;
    let currentUser = null;
    let isViewOnly = false;
    let viewUserId = null;
    let authToken = null;

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

    // ==================== Pure Fetch API Helper ====================

    async function supabaseFetch(endpoint, options = {}) {
        const url = `${SUPABASE_URL}/rest/v1/${endpoint}`;
        
        const headers = {
            'apikey': SUPABASE_ANON_KEY,
            'Content-Type': 'application/json',
            ...options.headers
        };

        if (authToken) {
            headers['Authorization'] = `Bearer ${authToken}`;
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);

        try {
            const response = await fetch(url, {
                ...options,
                headers,
                signal: controller.signal
            });
            clearTimeout(timeoutId);

            const data = await response.json();
            
            if (!response.ok) {
                throw new Error(data.message || `HTTP ${response.status}`);
            }
            
            return { data, error: null };
        } catch (err) {
            clearTimeout(timeoutId);
            if (err.name === 'AbortError') {
                throw new Error('Request timeout');
            }
            throw err;
        }
    }

    // ==================== Auth API ====================

    async function signIn(email, password) {
        const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
            method: 'POST',
            headers: {
                'apikey': SUPABASE_ANON_KEY,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ email, password })
        });

        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.error_description || data.msg || 'Login failed');
        }
        
        return data;
    }

    async function signUp(email, password) {
        const response = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
            method: 'POST',
            headers: {
                'apikey': SUPABASE_ANON_KEY,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ email, password })
        });

        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.error_description || data.msg || 'Signup failed');
        }
        
        return data;
    }

    async function signOut() {
        await fetch(`${SUPABASE_URL}/auth/v1/logout`, {
            method: 'POST',
            headers: {
                'apikey': SUPABASE_ANON_KEY,
                'Authorization': `Bearer ${authToken}`
            }
        });
        authToken = null;
        currentUser = null;
    }

    // ==================== Initialization ====================

    function init() {
        // Safety timeout - hide loading screen after 10 seconds
        const safetyTimeout = setTimeout(() => {
            console.log('Safety timeout, hiding loading screen');
            hideLoading();
            showAuth();
        }, 10000);

        // Try to restore session from localStorage
        const savedToken = localStorage.getItem('gTradeToken');
        const savedUser = localStorage.getItem('gTradeUser');
        
        if (savedToken && savedUser) {
            authToken = savedToken;
            currentUser = JSON.parse(savedUser);
            hideLoading();
            showApp();
            loadTrades();
        } else {
            hideLoading();
            showAuth();
        }
        
        clearTimeout(safetyTimeout);
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

            document.getElementById('headerButtons').innerHTML =
                '<button class="btn" id="equityBtn">Equity Curve</button>';
            document.getElementById('equityBtn').addEventListener('click', showEquityChart);

            loadSharedTrades(userId);
            return true;
        }
        return false;
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

        ['newRisk', 'newRR', 'newResult'].forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.addEventListener('input', updateAutoPL);
                el.addEventListener('change', updateAutoPL);
            }
        });

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
        showAuthInfo(isLoginMode ? "Signing in..." : "Creating account...");

        try {
            let data;
            
            if (isLoginMode) {
                data = await signIn(email, password);
            } else {
                data = await signUp(email, password);
            }

            if (data.access_token) {
                authToken = data.access_token;
                currentUser = { id: data.user.id, email: data.user.email };
                
                // Save to localStorage
                localStorage.setItem('gTradeToken', authToken);
                localStorage.setItem('gTradeUser', JSON.stringify(currentUser));
                
                showAuthSuccess(isLoginMode ? "Signed in!" : "Account created!");
                
                setTimeout(() => {
                    showApp();
                    loadTrades();
                }, 500);
            } else if (isLoginMode && !data.session) {
                showAuthSuccess("Check your email to confirm!");
            }
            
        } catch (error) {
            console.error("Auth error:", error);
            showAuthError(translateError(error.message));
        } finally {
            authPrimaryBtn.disabled = false;
        }
    }

    async function logout() {
        try {
            await signOut();
        } catch (e) {
            console.log('Logout API error (ignored):', e.message);
        }
        localStorage.removeItem('gTradeToken');
        localStorage.removeItem('gTradeUser');
        authToken = null;
        currentUser = null;
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
            "Invalid email or password": "Invalid email or password",
            "Password should be at least 6 characters": "Password must be at least 6 characters",
            "Unable to validate email address: invalid format": "Invalid email format",
            "Failed to fetch": "Network error. Check connection."
        };
        return translations[msg] || msg;
    }

    // ==================== Trades Management ====================

    async function loadTrades() {
        if (!currentUser) return;

        try {
            const { data, error } = await supabaseFetch(
                `trades?user_id=eq.${currentUser.id}&order=date.desc`
            );

            if (error) throw error;

            trades = data || [];
            renderTrades();
        } catch (err) {
            console.error('Load trades error:', err);
            showTradesError('Error loading trades. Refresh page.');
        }
    }

    async function loadSharedTrades(userId) {
        try {
            // Check if user has public sharing enabled
            const { data: profileData, error: profileError } = await supabaseFetch(
                `user_profiles?user_id=eq.${userId}`
            );

            if (profileError || !profileData || !profileData[0] || !profileData[0].is_public) {
                showTradesError('This journal is not public');
                return;
            }

            const { data, error } = await supabaseFetch(
                `trades?user_id=eq.${userId}&order=date.desc`
            );

            if (error) throw error;

            trades = data || [];
            renderTrades();
        } catch (err) {
            console.error('Load shared trades error:', err);
            showTradesError('Error loading trades');
        }
    }

    function renderTrades() {
        const tbody = document.getElementById('tradesBody');
        if (!tbody) return;
        
        tbody.innerHTML = '';

        if (trades.length === 0) {
            tbody.innerHTML = '<tr><td colspan="11" style="text-align: center; color: #666; padding: 40px;">No trades yet</td></tr>';
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
            alert('Error: No active user');
            return;
        }

        const pair = document.getElementById('newPair').value.trim() || 'XAUUSD';
        const date = document.getElementById('newDate').value;

        if (!date) {
            alert('Select date');
            return;
        }

        const risk = document.getElementById('newRisk').value.trim();
        const rr = document.getElementById('newRR').value.trim();
        const result = document.getElementById('newResult').value;

        if (!risk) {
            alert('Enter Risk %');
            return;
        }
        if (!result) {
            alert('Select Result');
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

        console.log('Adding trade:', trade);

        try {
            const { data, error } = await supabaseFetch('trades', {
                method: 'POST',
                body: JSON.stringify(trade)
            });

            if (error) throw error;

            console.log('Trade added:', data);
            hideForm();
            loadTrades();
        } catch (err) {
            console.error('Add trade error:', err);
            alert('Error adding trade: ' + err.message);
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
            alert('Error: No active user');
            return;
        }

        const pair = document.getElementById('editPair').value.trim() || 'XAUUSD';
        const date = document.getElementById('editDate').value;

        if (!date) {
            alert('Select date');
            return;
        }

        const risk = document.getElementById('editRisk').value.trim();
        const rr = document.getElementById('editRR').value.trim();
        const result = document.getElementById('editResult').value;

        if (!risk) {
            alert('Enter Risk %');
            return;
        }
        if (!result) {
            alert('Select Result');
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

        console.log('Updating trade:', updatedTrade);

        try {
            const { data, error } = await supabaseFetch(`trades?id=eq.${editingTradeId}`, {
                method: 'PATCH',
                body: JSON.stringify(updatedTrade)
            });

            if (error) throw error;

            console.log('Trade updated:', data);
            window.cancelEditForm();
            loadTrades();
        } catch (err) {
            console.error('Update trade error:', err);
            alert('Error updating trade: ' + err.message);
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
            const { error } = await supabaseFetch(`trades?id=eq.${id}`, {
                method: 'DELETE'
            });
            if (error) throw error;
            loadTrades();
        } catch (err) {
            console.error('Delete error:', err);
            alert('Error deleting trade: ' + err.message);
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
            const { data, error } = await supabaseFetch(
                `user_profiles?user_id=eq.${currentUser.id}`
            );

            if (error && error.code !== 'PGRST116') throw error;

            if (data && data[0] && data[0].is_public) {
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
            // First try to update
            const { data: existing } = await supabaseFetch(
                `user_profiles?user_id=eq.${currentUser.id}`
            );

            if (existing && existing[0]) {
                await supabaseFetch(`user_profiles?user_id=eq.${currentUser.id}`, {
                    method: 'PATCH',
                    body: JSON.stringify({ is_public: !isActive })
                });
            } else {
                await supabaseFetch('user_profiles', {
                    method: 'POST',
                    body: JSON.stringify({
                        user_id: currentUser.id,
                        is_public: !isActive
                    })
                });
            }

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
            alert('Error changing settings: ' + err.message);
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
            linkEl.textContent = '✓ Copied!';
            setTimeout(() => {
                linkEl.textContent = original;
            }, 2000);
        }).catch(err => {
            console.error('Copy failed:', err);
            alert('Failed to copy link');
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

    // ==================== Initialize ====================

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();

