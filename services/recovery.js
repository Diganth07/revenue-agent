const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { analyzeWithOpenRouter } = require('./openrouter');

const databasePath = process.env.RECOVERY_DB_PATH
    || (process.env.VERCEL ? path.join('/tmp', 'recovery-store.sqlite') : path.join(__dirname, '..', 'data', 'recovery-store.sqlite'));
const legacyStorePath = process.env.RECOVERY_STORE_PATH
    || (process.env.VERCEL ? path.join('/tmp', 'recovery-store.json') : path.join(__dirname, '..', 'data', 'recovery-store.json'));
const emptyStore = () => ({ auditLog: [], promises: [], metrics: {
    totalAttempted: 0,
    totalRecovered: 0,
    totalAmount: 0,
    recoveredAmount: 0,
    byLossType: {}
} });

fs.mkdirSync(path.dirname(databasePath), { recursive: true });
const database = new DatabaseSync(databasePath);
database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = FULL;
    CREATE TABLE IF NOT EXISTS recovery_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        payload TEXT NOT NULL
    );
`);
const readState = database.prepare('SELECT payload FROM recovery_state WHERE id = 1');
const writeState = database.prepare(`
    INSERT INTO recovery_state (id, payload) VALUES (1, ?)
    ON CONFLICT(id) DO UPDATE SET payload = excluded.payload
`);
let migratedFromJson = false;

function loadStore() {
    const savedState = readState.get();
    if (savedState) return JSON.parse(savedState.payload);

    if (fs.existsSync(legacyStorePath)) {
        let legacyState;
        try {
            legacyState = JSON.parse(fs.readFileSync(legacyStorePath, 'utf8'));
        } catch (error) {
            throw new Error(`Could not import the existing recovery store: ${error.message}`);
        }
        writeState.run(JSON.stringify(legacyState));
        migratedFromJson = true;
        return legacyState;
    }

    return emptyStore();
}

function saveStore() {
    writeState.run(JSON.stringify({ auditLog, promises, metrics }));
}

const store = loadStore();
let auditLog = Array.isArray(store.auditLog) ? store.auditLog : [];
let promises = Array.isArray(store.promises) ? store.promises : [];
let metrics = store.metrics || emptyStore().metrics;

const workflowDefinitions = {
    PAYMENT_FAILURE: {
        name: 'Payment degradation',
        actions: ['RETRY', 'NOTIFY', 'OFFER_UPI', 'ESCALATE']
    },
    CHECKOUT_DROPOFF: {
        name: 'Checkout drop-off recovery',
        actions: ['NOTIFY', 'OFFER_UPI', 'ESCALATE']
    },
    SUBSCRIPTION_FAILURE: {
        name: 'Failed-subscription recovery',
        actions: ['RETRY', 'NOTIFY', 'ESCALATE']
    },
    OVERDUE_INVOICE: {
        name: 'B2B receivables chaser',
        actions: ['CHASE', 'TRACK_PROMISE', 'ESCALATE']
    },
    MANDATE_FAILURE: {
        name: 'Mandate retry sequencer',
        actions: ['RETRY', 'NOTIFY', 'ESCALATE']
    },
    PROMISE_TO_PAY: {
        name: 'Promise-to-pay tracker',
        actions: ['TRACK_PROMISE', 'CHASE', 'ESCALATE']
    }
};

function getPriority(amount, retryCount, action) {
    const score = (Number(amount) >= 10000 ? 2 : Number(amount) >= 2000 ? 1 : 0)
        + (Number(retryCount) >= 2 ? 2 : Number(retryCount) === 1 ? 1 : 0)
        + (action === 'ESCALATE' ? 2 : 0);
    return {
        score,
        label: score >= 4 ? 'HIGH' : score >= 2 ? 'MEDIUM' : 'LOW'
    };
}

async function handleRecovery(lossType, amount, customer, reason, options = {}) {
    const workflow = workflowDefinitions[lossType] || workflowDefinitions.PAYMENT_FAILURE;
    const retryCount = Number(options.retryCount || 0);
    const boundedRetryCount = Math.min(Math.max(retryCount, 0), 3);
    const shouldEscalate = boundedRetryCount >= 3;

    // Step 1: Call AI
    console.log('🧠 Recovery function called — asking the configured AI provider...');
    const analysis = await analyzeWithOpenRouter(reason, amount, {
        workflow: workflow.name,
        customer,
        language: options.language,
        retryCount: boundedRetryCount,
        dueDate: options.dueDate,
        promiseDate: options.promiseDate
    });

    if (shouldEscalate) analysis.action = 'ESCALATE';
    if (!workflow.actions.includes(analysis.action)) analysis.action = workflow.actions[0];

    const retryScheduleMinutes = [5, 30, 120];
    const nextRetryMinutes = analysis.action === 'RETRY'
        ? retryScheduleMinutes[Math.min(boundedRetryCount, retryScheduleMinutes.length - 1)]
        : null;
    const nextRetryAt = nextRetryMinutes
        ? new Date(Date.now() + nextRetryMinutes * 60 * 1000).toISOString()
        : null;

    // Step 2: Execute action
    let actionResult;
    switch (analysis.action) {
        case 'RETRY':
            actionResult = `Retry ${boundedRetryCount + 1} scheduled in ${nextRetryMinutes} minutes.`;
            break;
        case 'NOTIFY':
            actionResult = `Notification sent: "${analysis.message}"`;
            break;
        case 'OFFER_UPI':
            actionResult = `UPI suggestion sent: "${analysis.message}"`;
            break;
        case 'ESCALATE':
            actionResult = 'Issue escalated to human support.';
            break;
        case 'CHASE':
            actionResult = 'B2B receivables follow-up scheduled.';
            break;
        case 'TRACK_PROMISE':
            actionResult = 'Promise to pay recorded for follow-up.';
            break;
        default:
            actionResult = 'No action taken.';
    }

    // Step 3: Audit
    const entry = {
        id: auditLog.length + 1,
        timestamp: new Date().toISOString(),
        lossType,
        amount,
        customer,
        reason,
        action: analysis.action,
        message: analysis.message,
        rootCause: analysis.rootCause,
        result: actionResult,
        workflow: workflow.name,
        retryCount: boundedRetryCount,
        language: analysis.language || options.language || 'ENGLISH',
        provider: analysis.provider || 'openrouter',
        aiFallback: Boolean(analysis.fallback),
        promiseDate: options.promiseDate || null,
        source: options.source || 'api',
        orderId: options.orderId || null,
        nextRetryAt,
        nextRetryMinutes,
        retryLimit: 3,
        priority: getPriority(amount, boundedRetryCount, analysis.action),
        resolved: false
    };
    auditLog.push(entry);
    if (options.orderId) updateCheckoutStatus(options.orderId, 'failed', options.paymentId);

    if (analysis.action === 'TRACK_PROMISE' || options.promiseDate) {
        promises.push({
            id: promises.length + 1,
            auditId: entry.id,
            customer,
            amount,
            promiseDate: options.promiseDate || null,
            status: 'OPEN',
            createdAt: entry.timestamp
        });
    }

    // Step 4: Update metrics
    metrics.totalAttempted++;
    metrics.totalAmount += amount;
    metrics.byLossType[lossType] = (metrics.byLossType[lossType] || 0) + 1;

    saveStore();

    return { entry, analysis };
}

function recordCheckoutStarted(amount, customer, orderId) {
    const entry = {
        id: auditLog.length + 1,
        timestamp: new Date().toISOString(),
        lossType: 'CHECKOUT_STARTED',
        amount: Number(amount) || 0,
        customer,
        reason: 'Customer started hosted checkout',
        action: 'PAYMENT_PENDING',
        message: 'Payment checkout opened.',
        rootCause: 'Awaiting customer payment.',
        result: 'Hosted payment checkout opened; awaiting result.',
        workflow: 'Payment checkout',
        orderId,
        paymentStatus: 'created',
        source: 'checkout-session',
        resolved: false
    };
    auditLog.push(entry);
    saveStore();
    return entry;
}

function updateCheckoutStatus(orderId, status, paymentId = null) {
    const entry = auditLog.find(item => item.lossType === 'CHECKOUT_STARTED' && item.orderId === orderId);
    if (!entry || (entry.paymentStatus !== 'created' && status !== 'captured')) return entry || null;
    if (entry.paymentStatus === 'captured') return entry;

    entry.paymentStatus = status;
    entry.paymentId = paymentId;
    entry.resolved = status !== 'created';
    entry.action = status === 'captured'
        ? 'PAYMENT_CAPTURED'
        : status === 'failed'
            ? 'PAYMENT_FAILED'
            : 'CHECKOUT_ABANDONED';
    entry.result = status === 'captured'
        ? 'Payment captured and verified.'
        : status === 'failed'
            ? 'Payment failed; recovery follow-up recorded.'
            : 'Checkout closed before payment.';
    if (status === 'dismissed') entry.reason = 'Customer closed checkout without completing payment';
    saveStore();
    return entry;
}

function recordSuccessfulPayment(amount, customer, paymentId = null, orderId = null) {
    if (orderId) {
        const existingPayment = auditLog.find(item => item.lossType === 'PAYMENT_SUCCESS' && item.orderId === orderId);
        if (existingPayment) return existingPayment;
        updateCheckoutStatus(orderId, 'captured', paymentId);
        for (const entry of auditLog) {
            if (entry.orderId === orderId && entry.lossType !== 'PAYMENT_SUCCESS') {
                entry.resolved = true;
                entry.result = 'Payment recovered; no further follow-up is required.';
            }
        }
    }
    const numericAmount = Number(amount) || 0;
    const entry = {
        id: auditLog.length + 1,
        timestamp: new Date().toISOString(),
        lossType: 'PAYMENT_SUCCESS',
        amount: numericAmount,
        customer,
        reason: 'Razorpay payment captured successfully',
        action: 'PAYMENT_CAPTURED',
        message: 'Payment captured successfully.',
        rootCause: 'Payment completed successfully.',
        result: 'Revenue recovered through successful payment.',
        workflow: 'Payment recovery',
        paymentId,
        orderId,
        resolved: true
    };

    auditLog.push(entry);
    metrics.totalRecovered++;
    metrics.recoveredAmount += numericAmount;
    saveStore();
    return entry;
}

function getMetrics() {
    return {
        totalAttempted: metrics.totalAttempted,
        totalRecovered: metrics.totalRecovered,
        recoveryRate: metrics.totalAttempted > 0 ? Math.round((metrics.totalRecovered / metrics.totalAttempted) * 100) : 0,
        totalAmount: metrics.totalAmount,
        recoveredAmount: metrics.recoveredAmount,
        byLossType: metrics.byLossType,
        auditLog: auditLog.slice(-20),
        openPromises: promises.filter(item => item.status === 'OPEN').length,
        atRiskAmount: auditLog
            .filter(item => !item.resolved && ['api', 'audit-trail', 'checkout', 'checkout-session', 'razorpay-webhook'].includes(item.source))
            .reduce((sum, item) => sum + (Number(item.amount) || 0), 0)
    };
}

function getAuditLog() {
    return auditLog;
}

function getAuditEntry(id) {
    return auditLog.find(item => item.id === Number(id)) || null;
}

function getPromises() {
    return promises;
}

function getWorkflows() {
    return Object.entries(workflowDefinitions).map(([id, definition]) => ({ id, ...definition }));
}

function getStorageStatus() {
    return {
        engine: 'SQLite',
        persistent: !process.env.VERCEL,
        integrity: database.prepare('PRAGMA integrity_check').get().integrity_check,
        migratedFromJson,
        note: process.env.VERCEL ? 'The serverless filesystem is temporary; use a hosted database for durable storage.' : null
    };
}

function attachPaymentLink(auditId, paymentLink) {
    const entry = auditLog.find(item => item.id === Number(auditId));
    if (!entry) return null;
    entry.paymentLinkId = paymentLink.id || null;
    entry.paymentLinkUrl = paymentLink.short_url || paymentLink.shortUrl || null;
    entry.paymentLinkStatus = paymentLink.status || 'created';
    saveStore();
    return entry;
}

function recordPaymentLinkPaid(paymentLinkId, paymentId, amount) {
    const entry = auditLog.find(item => item.paymentLinkId === paymentLinkId);
    if (!entry || entry.paymentStatus === 'captured') return entry;

    entry.paymentStatus = 'captured';
    entry.paymentId = paymentId || null;
    entry.paymentLinkStatus = 'paid';
    entry.resolved = true;
    entry.resolvedAt = new Date().toISOString();
    entry.result = 'Payment recovered through the AI-generated Razorpay payment link.';
    metrics.totalRecovered++;
    metrics.recoveredAmount += Number(amount || entry.amount) || 0;
    saveStore();
    return entry;
}

function resetStore() {
    auditLog = [];
    promises = [];
    metrics = emptyStore().metrics;
    saveStore();
}

module.exports = { handleRecovery, recordCheckoutStarted, updateCheckoutStatus, recordSuccessfulPayment, getMetrics, getAuditLog, getAuditEntry, getPromises, getWorkflows, getStorageStatus, attachPaymentLink, recordPaymentLinkPaid, resetStore };