const app = document.getElementById('app');
const viewTitles = {
    overview: 'Recovery overview',
    payments: 'Collect a payment',
    audit: 'Audit & promises',
    integrations: 'API & integrations'
};
const state = { status: null, metrics: null, audit: [], promises: [], filter: '' };
let toastTimer;

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[character]));
}

function money(value) {
    return new Intl.NumberFormat('en-IN', {
        style: 'currency', currency: 'INR', maximumFractionDigits: 0
    }).format(Number(value) || 0);
}

async function request(path, options = {}) {
    const response = await fetch(path, {
        ...options,
        headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
    return data;
}

function showToast(message, isError = false) {
    document.querySelector('.toast')?.remove();
    const toast = document.createElement('div');
    toast.className = `toast${isError ? ' is-error' : ''}`;
    toast.setAttribute('role', 'status');
    toast.textContent = message;
    document.body.append(toast);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.remove(), 3600);
}

function appMarkup() {
    return `
        <div class="app-shell">
            <aside class="sidebar">
                <div class="brand"><div class="brand-mark">R</div><div><div class="brand-name">Revenue Desk</div><div class="brand-caption">RECOVERY OPERATIONS</div></div></div>
                <div class="nav-label">Workspace</div>
                <nav class="nav-list" aria-label="Main navigation">
                    <button class="nav-button is-active" data-view="overview"><span class="nav-icon">⌂</span> Overview</button>
                    <button class="nav-button" data-view="payments"><span class="nav-icon">↗</span> Payments</button>
                    <button class="nav-button" data-view="audit"><span class="nav-icon">≡</span> Audit & promises</button>
                    <button class="nav-button" data-view="integrations"><span class="nav-icon">⌘</span> APIs & integrations</button>
                </nav>
                <div class="sidebar-bottom"><div class="side-status"><span class="status-light" data-api-light></span><span data-side-status>Connecting to API</span></div><div class="side-version">LOCAL WORKSPACE · V1.0</div></div>
            </aside>
            <main class="workspace">
                <header class="topbar">
                    <div><div class="breadcrumb">Revenue operations / Workspace</div><h1 class="page-title" data-page-title>Recovery overview</h1></div>
                    <div class="top-actions"><div class="api-pill" data-api-pill><span class="status-light" data-api-light></span><span data-api-label>Connecting</span></div><button class="icon-button" data-action="refresh" title="Refresh dashboard" aria-label="Refresh dashboard">↻</button></div>
                </header>

                <section class="page-content is-active" data-page="overview">
                    <div class="metric-grid" id="metrics"><div class="metric"><div class="metric-label">Loading workspace</div><div class="metric-value">...</div></div></div>
                    <div class="overview-grid">
                        <section class="panel">
                            <div class="panel-heading"><h2>Event mix</h2><small>RECORDED RECOVERY EVENTS</small></div>
                            <div class="breakdown-list" id="breakdown"><div class="empty-state">Loading event mix...</div></div>
                        </section>
                        <section class="panel quick-panel">
                            <div><div class="eyebrow">Payments</div><h2>Take a payment in a few clicks.</h2><p>Open secure hosted checkout and track the result in your activity log.</p></div>
                            <button class="button-primary" data-view="payments">Open payments <span aria-hidden="true">→</span></button>
                        </section>
                    </div>
                    <section class="panel table-panel">
                        <div class="panel-heading"><h2>Latest activity</h2><button class="button-secondary" data-view="audit">Open audit trail →</button></div>
                        <div class="table-wrap"><table><thead><tr><th>Customer</th><th>Event</th><th>Amount</th><th>Decision</th><th>Time</th></tr></thead><tbody id="recent-activity"></tbody></table></div>
                    </section>
                </section>

                <section class="page-content" data-page="payments">
                    <div class="section-heading"><div><h2>Secure payment checkout</h2><p>Start a hosted payment session. Successful payments are verified and added to your activity log.</p></div><span class="badge badge--quiet" data-checkout-badge>Checking</span></div>
                    <div class="form-layout">
                        <section class="panel">
                            <form id="checkout-form">
                                <div class="form-grid">
                                    <label class="field">Customer name<input name="customer" value="Demo Customer" maxlength="120" required /></label>
                                    <label class="field">Amount (INR)<input name="amount" type="number" min="1" max="100000000" step="1" value="500" required /></label>
                                </div>
                                <div class="form-actions"><button class="button-primary" type="submit" data-action="checkout">Open secure checkout <span aria-hidden="true">↗</span></button><span class="helper-text">Payment credentials are required in the server environment.</span></div>
                            </form>
                            <div id="payment-result" aria-live="polite"></div>
                        </section>
                        <section class="panel quick-panel">
                            <div><div class="eyebrow">Hosted payment</div><h2>One clear link from amount to confirmation.</h2><p>Customer details stay with your server. Card and wallet information is entered only in the hosted checkout.</p></div>
                            <span class="badge" data-payment-status>Checking connection</span>
                        </section>
                    </div>
                </section>

                <section class="page-content" data-page="audit">
                    <div class="section-heading"><div><h2>Recovery audit</h2><p>Decisions, outcomes, and payment promises recorded by the service.</p></div><div class="inline-tools"><input class="search-input" id="audit-search" type="search" placeholder="Search customer, event, or action" aria-label="Search audit log" /><button class="button-secondary" data-action="refresh">Refresh</button></div></div>
                    <section class="panel table-panel"><div class="table-wrap"><table><thead><tr><th>Time</th><th>Customer</th><th>Event / reason</th><th>Amount</th><th>Action</th><th>Outcome</th></tr></thead><tbody id="audit-rows"></tbody></table></div></section>
                    <section class="panel"><div class="panel-heading"><h2>Promise-to-pay follow-up</h2><small id="promise-count">—</small></div><div class="promise-list" id="promise-list"><div class="empty-state">Loading promises...</div></div></section>
                </section>

                <section class="page-content" data-page="integrations">
                    <div class="section-heading"><div><h2>API health & configuration</h2><p>Routes are served by this app under <span class="mono">/api/agent</span>. Secrets are never shown here.</p></div><button class="button-secondary" data-action="refresh">Check again</button></div>
                    <div class="integration-grid">
                        <section class="integration-card"><div class="integration-top"><h2>Recovery API</h2><span class="badge" data-integration-api>Checking</span></div><p>Health check, recovery decisions, metrics, workflows, promises, and audit actions.</p><div class="integration-meta">GET /api/agent/status</div></section>
                        <section class="integration-card"><div class="integration-top"><h2>AI decision provider</h2><span class="badge badge--quiet" data-integration-ai>Checking</span></div><p>Uses the selected provider when configured; local workflow rules keep the simulator available as a fallback.</p><div class="integration-meta" data-ai-detail>Provider: checking</div></section>
                        <section class="integration-card"><div class="integration-top"><h2>Payment checkout</h2><span class="badge badge--quiet" data-integration-payments>Checking</span></div><p>Hosted checkout and payment links use server-side payment credentials. Signed callbacks require a webhook secret.</p><div class="integration-meta" data-payment-detail>Credentials: checking</div></section>
                        <section class="integration-card"><div class="integration-top"><h2 data-storage-title>SQLite storage</h2><span class="badge badge--quiet" data-integration-storage>Checking</span></div><p>Audit and metric data are written to the local database. Serverless filesystems are temporary and need hosted storage for durable history.</p><div class="integration-meta" data-storage-detail>Storage status: checking</div></section>
                    </div>
                    <section class="panel table-panel"><div class="panel-heading"><h2>Registered endpoints</h2><small id="endpoint-count">—</small></div><div class="table-wrap"><table class="endpoint-table"><thead><tr><th>Method</th><th>Path</th></tr></thead><tbody id="endpoint-rows"></tbody></table></div></section>
                    <section class="panel"><div class="panel-heading"><h2>Demo data</h2></div><p class="helper-text">Clearing demo data removes audit records, promises, and accumulated metrics from the configured recovery store.</p><div class="form-actions"><button class="button-danger" data-action="reset">Reset demo data</button></div></section>
                </section>
            </main>
        </div>`;
}

function activateView(view) {
    if (!viewTitles[view]) return;
    document.querySelectorAll('.page-content').forEach(page => page.classList.toggle('is-active', page.dataset.page === view));
    document.querySelectorAll('.nav-button').forEach(button => button.classList.toggle('is-active', button.dataset.view === view));
    document.querySelector('[data-page-title]').textContent = viewTitles[view];
    history.replaceState(null, '', `#${view}`);
}

function setApiHealth(isOnline) {
    const pill = document.querySelector('[data-api-pill]');
    pill.classList.toggle('is-down', !isOnline);
    document.querySelectorAll('[data-api-light]').forEach(light => light.classList.toggle('is-down', !isOnline));
    document.querySelector('[data-api-label]').textContent = isOnline ? 'API connected' : 'API unavailable';
    document.querySelector('[data-side-status]').textContent = isOnline ? 'API connected' : 'API unavailable';
}

function renderMetrics() {
    const metrics = state.metrics || {};
    const cells = [
        ['Events processed', metrics.totalAttempted || 0, 'Recovery attempts'],
        ['Recovered', metrics.totalRecovered || 0, 'Payments captured'],
        ['Recovery rate', `${metrics.recoveryRate || 0}%`, 'Captured / attempted'],
        ['Recovered revenue', money(metrics.recoveredAmount), 'Confirmed payments'],
        ['At risk', money(metrics.atRiskAmount), 'Open recoverable cases']
    ];
    document.getElementById('metrics').innerHTML = cells.map(([label, value, note], index) => `
        <div class="metric"><div class="metric-label">${label}</div><div class="metric-value${index === 3 ? ' is-highlight' : ''}">${escapeHtml(value)}</div><div class="metric-note">${note}</div></div>
    `).join('');

    const lossTypes = Object.entries(metrics.byLossType || {}).sort((left, right) => right[1] - left[1]);
    const max = Math.max(1, ...lossTypes.map(([, count]) => Number(count) || 0));
    document.getElementById('breakdown').innerHTML = lossTypes.length ? lossTypes.map(([name, count]) => `
        <div class="breakdown-row"><div class="breakdown-name">${escapeHtml(name.replaceAll('_', ' ').toLowerCase())}</div><div class="bar-track"><div class="bar-fill" style="width:${Math.max(2, (Number(count) / max) * 100)}%"></div></div><div class="breakdown-count">${Number(count) || 0}</div></div>
    `).join('') : '<div class="empty-state">No recovery events recorded yet.</div>';
}

function actionBadge(action) {
    const styles = { ESCALATE: 'badge--danger', RETRY: '', OFFER_UPI: 'badge--info', CHASE: 'badge--warning', TRACK_PROMISE: 'badge--info', PAYMENT_CAPTURED: '' };
    return `<span class="badge ${styles[action] || 'badge--quiet'}">${escapeHtml(action || '—')}</span>`;
}

function renderActivity() {
    const rows = [...state.audit].reverse().slice(0, 8);
    document.getElementById('recent-activity').innerHTML = rows.length ? rows.map(entry => `
        <tr><td>${escapeHtml(entry.customer || '—')}</td><td>${escapeHtml((entry.lossType || '—').replaceAll('_', ' '))}</td><td>${money(entry.amount)}</td><td>${actionBadge(entry.action)}</td><td class="mono">${escapeHtml(new Date(entry.timestamp).toLocaleString())}</td></tr>
    `).join('') : '<tr><td colspan="5" class="empty-state">No activity yet. Run a recovery or batch demo to get started.</td></tr>';
}

function renderAudit() {
    const query = state.filter.trim().toLowerCase();
    const rows = [...state.audit].reverse().filter(entry => [entry.customer, entry.lossType, entry.reason, entry.action, entry.result].join(' ').toLowerCase().includes(query));
    document.getElementById('audit-rows').innerHTML = rows.length ? rows.map(entry => `
        <tr>
            <td class="mono">${escapeHtml(new Date(entry.timestamp).toLocaleString())}</td>
            <td>${escapeHtml(entry.customer || '—')}</td>
            <td>${escapeHtml((entry.lossType || '—').replaceAll('_', ' '))}<div class="helper-text">${escapeHtml(entry.reason || '')}</div></td>
            <td>${money(entry.amount)}</td><td>${actionBadge(entry.action)}</td>
            <td>${escapeHtml(entry.result || '—')}</td>
        </tr>
    `).join('') : '<tr><td colspan="6" class="empty-state">No matching audit events.</td></tr>';

    document.getElementById('promise-count').textContent = `${state.promises.length} TOTAL`;
    document.getElementById('promise-list').innerHTML = state.promises.length ? [...state.promises].reverse().map(promise => `
        <div class="promise-row"><div><div class="promise-name">${escapeHtml(promise.customer || 'Customer')}</div><div class="promise-detail">${escapeHtml(promise.promiseDate || 'No date provided')} · Created ${escapeHtml(new Date(promise.createdAt).toLocaleDateString())}</div></div><div><strong>${money(promise.amount)}</strong> <span class="badge ${promise.status === 'OPEN' ? 'badge--warning' : ''}">${escapeHtml(promise.status || 'OPEN')}</span></div></div>
    `).join('') : '<div class="empty-state">No payment promises are being tracked.</div>';
}

function renderIntegrations() {
    const status = state.status;
    if (!status) {
        const apiBadge = document.querySelector('[data-integration-api]');
        apiBadge.textContent = 'Unavailable';
        apiBadge.classList.add('badge--danger');
        document.querySelector('[data-integration-ai]').textContent = 'Status unavailable';
        document.querySelector('[data-ai-detail]').textContent = 'Provider status could not be checked';
        document.querySelector('[data-integration-payments]').textContent = 'Status unavailable';
        document.querySelector('[data-payment-detail]').textContent = 'Credential status could not be checked';
        document.querySelector('[data-checkout-badge]').textContent = 'API unavailable';
        document.querySelector('#checkout-form [type="submit"]').disabled = true;
        document.querySelector('[data-payment-status]').textContent = 'API unavailable';
        document.querySelector('[data-integration-storage]').textContent = 'Status unavailable';
        document.querySelector('[data-storage-detail]').textContent = 'Storage status could not be checked';
        document.getElementById('endpoint-count').textContent = 'API UNAVAILABLE';
        document.getElementById('endpoint-rows').innerHTML = '<tr><td colspan="2" class="empty-state">Could not load the registered endpoints.</td></tr>';
        return;
    }
    const ai = status.ai || {};
    const razorpay = status.razorpay || {};
    const storage = status.storage || {};
    const apiBadge = document.querySelector('[data-integration-api]');
    apiBadge.textContent = 'Connected';
    apiBadge.classList.remove('badge--danger');
    document.querySelector('[data-integration-ai]').textContent = ai.provider === 'local' ? 'Available' : ai.configured ? 'Key present' : 'Local fallback';
    document.querySelector('[data-ai-detail]').textContent = `Provider: ${ai.provider || 'local'}${ai.provider === 'local' ? ' · local workflow rules' : ai.fallback ? ' · using local fallback' : ' · key presence only; not validated'}`;
    document.querySelector('[data-integration-payments]').textContent = razorpay.configured ? 'Keys present' : 'Not configured';
    document.querySelector('[data-payment-detail]').textContent = `Credentials: ${razorpay.configured ? 'present, not validated' : 'missing'} · Webhook: ${razorpay.webhookConfigured ? 'present' : 'not configured'}`;
    document.querySelector('[data-checkout-badge]').textContent = razorpay.configured ? 'Keys present' : 'Needs credentials';
    document.querySelector('[data-payment-status]').textContent = razorpay.configured ? 'Connection details present' : 'Payment credentials required';
    document.querySelector('#checkout-form [type="submit"]').disabled = !razorpay.configured;
    document.querySelector('[data-integration-storage]').textContent = storage.persistent ? 'Persistent' : 'Temporary';
    document.querySelector('[data-storage-detail]').textContent = storage.persistent
        ? `SQLite file${storage.migratedFromJson ? ' · existing JSON history imported' : ''}`
        : storage.note || 'Temporary serverless storage';
    document.getElementById('endpoint-count').textContent = `${(status.endpoints || []).length} ROUTES`;
    document.getElementById('endpoint-rows').innerHTML = (status.endpoints || []).map(endpoint => {
        const [method, ...path] = endpoint.split(' ');
        return `<tr><td><span class="badge ${method === 'GET' ? 'badge--info' : ''}">${escapeHtml(method)}</span></td><td class="mono">${escapeHtml(path.join(' '))}</td></tr>`;
    }).join('');
}

async function refreshDashboard() {
    const results = await Promise.allSettled([
        request('/api/agent/status'), request('/api/agent/metrics'),
        request('/api/agent/audit'), request('/api/agent/promises')
    ]);
    const online = results[0].status === 'fulfilled';
    setApiHealth(online);
    state.status = online ? results[0].value : null;
    if (results[1].status === 'fulfilled') state.metrics = results[1].value;
    if (results[2].status === 'fulfilled') state.audit = results[2].value;
    if (results[3].status === 'fulfilled') state.promises = results[3].value;
    renderMetrics();
    renderActivity();
    renderAudit();
    renderIntegrations();
    if (!online) showToast('Could not reach the API. Start the app with npm start and refresh.', true);
}

function speakMessage(message, language, statusElement) {
    const synthesis = window.speechSynthesis;
    if (!synthesis || typeof SpeechSynthesisUtterance === 'undefined' || !message) {
        if (statusElement) statusElement.textContent = 'Speech is unavailable in this browser.';
        showToast('Speech is unavailable in this browser.', true);
        return;
    }

    const requestedLanguage = language === 'HINGLISH' ? 'en-IN' : 'en-US';
    const voices = synthesis.getVoices();
    const voice = voices.find(item => item.lang.toLowerCase() === requestedLanguage.toLowerCase())
        || voices.find(item => item.lang.toLowerCase().startsWith(requestedLanguage.slice(0, 2).toLowerCase()))
        || voices[0];
    const speech = new SpeechSynthesisUtterance(message);
    speech.lang = voice?.lang || requestedLanguage;
    if (voice) speech.voice = voice;
    speech.volume = 1;
    speech.rate = 0.95;
    speech.onstart = () => {
        if (statusElement) statusElement.textContent = `Speaking with ${voice?.name || 'your device voice'}...`;
    };
    speech.onend = () => {
        if (statusElement) statusElement.textContent = 'Message finished.';
    };
    speech.onerror = () => {
        if (statusElement) statusElement.textContent = 'Could not play aloud. Check device sound and tap Play message.';
        showToast('Could not play the voice message. Check device sound and try Play message.', true);
    };
    synthesis.cancel();
    synthesis.speak(speech);
    if (synthesis.paused) synthesis.resume();
}

async function startCheckout(event) {
    event.preventDefault();
    if (!state.status?.razorpay?.configured) return showToast('Add payment credentials to .env first.', true);
    if (typeof window.Razorpay !== 'function') return showToast('Secure checkout could not load. Check your network and try again.', true);
    const form = document.getElementById('checkout-form');
    const amount = Number(form.elements.amount.value);
    const customer = form.elements.customer.value || 'Customer';
    if (!Number.isFinite(amount) || amount <= 0) return showToast('Enter a valid amount greater than zero.', true);
    const button = form.querySelector('[type="submit"]');
    let paymentResolved = false;
    button.disabled = true;
    button.textContent = 'Opening checkout...';
    try {
        const order = await request('/api/agent/create-order', { method: 'POST', body: JSON.stringify({ amount, customer }) });
        await refreshDashboard();
        const checkout = new window.Razorpay({
            key: order.keyId, amount: Math.round(order.amount * 100), currency: order.currency,
            name: 'Revenue Desk', description: 'Payment recovery test checkout', order_id: order.orderId,
            prefill: { name: customer },
            modal: {
                ondismiss: async () => {
                    if (paymentResolved) return;
                    try {
                        await request(`/api/agent/checkout/${encodeURIComponent(order.orderId)}/dismiss`, { method: 'POST', body: '{}' });
                        await refreshDashboard();
                        showToast('Checkout closed. The attempt was added to the audit.');
                    } catch (error) { showToast(error.message, true); }
                }
            },
            handler: async payment => {
                paymentResolved = true;
                try {
                    const result = await request('/api/agent/verify-payment', { method: 'POST', body: JSON.stringify({ ...payment, amount, customer }) });
                    document.getElementById('payment-result').innerHTML = `<div class="result-box"><h3>Payment ${escapeHtml(result.paymentStatus)}</h3><p>Your payment was verified and recorded.</p></div>`;
                    showToast('Payment verified and recorded.');
                    await refreshDashboard();
                } catch (error) { showToast(error.message, true); }
            }
        });
        checkout.on('payment.failed', async event => {
            paymentResolved = true;
            const reason = event.error?.description || 'Payment could not be completed';
            showToast('Payment failed. Sending event to recovery workflow.');
            try {
                const result = await request('/api/agent/recover', { method: 'POST', body: JSON.stringify({ lossType: 'PAYMENT_FAILURE', amount, customer, reason, orderId: order.orderId, source: 'checkout' }) });
                const decision = result.recovery;
                document.getElementById('payment-result').innerHTML = `<div class="result-box"><h3>Next step: ${escapeHtml(decision.action)}</h3><p>${escapeHtml(decision.message)}</p><div class="result-actions"><button class="button-secondary" data-action="speak" data-message="${escapeHtml(decision.message)}" data-language="${escapeHtml(decision.language || 'ENGLISH')}">Play message</button>${decision.paymentLink ? `<a class="button-primary" href="${escapeHtml(decision.paymentLink)}" target="_blank" rel="noopener">Open payment link ↗</a>` : ''}<span class="helper-text" data-speech-status>Attempting spoken message...</span></div></div>`;
                speakMessage(decision.message, decision.language, document.querySelector('[data-speech-status]'));
                await refreshDashboard();
            } catch (error) { showToast(error.message, true); }
        });
        checkout.open();
    } catch (error) { showToast(error.message, true); }
    finally {
        button.disabled = !state.status?.razorpay?.configured;
        button.innerHTML = 'Open secure checkout <span aria-hidden="true">↗</span>';
    }
}

async function resetDemo() {
    if (!window.confirm('Reset all local demo metrics, audit events, and promise records?')) return;
    try {
        await request('/api/agent/reset-demo', { method: 'POST', body: '{}' });
        await refreshDashboard();
        showToast('Demo data reset.');
    } catch (error) { showToast(error.message, true); }
}

app.innerHTML = appMarkup();
activateView(location.hash.slice(1) || 'overview');
refreshDashboard();
setInterval(refreshDashboard, 20000);

document.addEventListener('click', event => {
    const viewButton = event.target.closest('[data-view]');
    if (viewButton) activateView(viewButton.dataset.view);
    const actionButton = event.target.closest('[data-action]');
    if (!actionButton) return;
    if (actionButton.dataset.action === 'refresh') refreshDashboard();
    if (actionButton.dataset.action === 'reset') resetDemo();
    if (actionButton.dataset.action === 'speak') speakMessage(actionButton.dataset.message, actionButton.dataset.language, actionButton.closest('.result-box')?.querySelector('[data-speech-status]'));
});

document.getElementById('checkout-form').addEventListener('submit', startCheckout);
document.getElementById('audit-search').addEventListener('input', event => {
    state.filter = event.target.value;
    renderAudit();
});