const fs = require('fs');
const path = require('path');
const { analyzeWithOpenRouter } = require('./openrouter');

const storePath = process.env.RECOVERY_STORE_PATH
    || (process.env.VERCEL ? path.join('/tmp', 'recovery-store.json') : path.join(__dirname, '..', 'data', 'recovery-store.json'));
const emptyStore = () => ({ auditLog: [], promises: [], metrics: {
    totalAttempted: 0,
    totalRecovered: 0,
    totalAmount: 0,
    recoveredAmount: 0,
    byLossType: {}
} });

function loadStore() {
    try {
        return JSON.parse(fs.readFileSync(storePath, 'utf8'));
    } catch (error) {
        return emptyStore();
    }
}

function saveStore() {
    fs.mkdirSync(path.dirname(storePath), { recursive: true });
    fs.writeFileSync(storePath, JSON.stringify({ auditLog, promises, metrics }, null, 2));
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

    // Step 2: Execute action
    let actionResult;
    switch (analysis.action) {
        case 'RETRY':
            actionResult = 'Retry scheduled.';
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
        resolved: false
    };
    auditLog.push(entry);

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

function recordSuccessfulPayment(amount, customer, paymentId = null) {
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
        openPromises: promises.filter(item => item.status === 'OPEN').length
    };
}

function getAuditLog() {
    return auditLog;
}

function getPromises() {
    return promises;
}

function getWorkflows() {
    return Object.entries(workflowDefinitions).map(([id, definition]) => ({ id, ...definition }));
}

function resetStore() {
    auditLog = [];
    promises = [];
    metrics = emptyStore().metrics;
    saveStore();
}

module.exports = { handleRecovery, recordSuccessfulPayment, getMetrics, getAuditLog, getPromises, getWorkflows, resetStore };