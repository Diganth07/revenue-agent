const express = require('express');
const router = express.Router();
const { createOrder, fetchPayment, verifyPaymentSignature, verifyWebhookSignature } = require('../services/razorpay');
const { handleRecovery, recordSuccessfulPayment, getMetrics, getAuditLog, getPromises, getWorkflows, resetStore } = require('../services/recovery');

// Test route
router.get('/test', (req, res) => {
    res.json({ message: 'Agent route is working!' });
});

// Recovery endpoint
router.post('/recover', async (req, res) => {
    try {
        const { lossType = 'PAYMENT_FAILURE', amount = 500, customer = 'Customer', reason = 'Unknown', ...options } = req.body;

        const result = await handleRecovery(lossType, amount, customer, reason, options);

        res.status(200).json({
            success: true,
            recovery: {
                action: result.analysis.action,
                message: result.analysis.message,
                rootCause: result.analysis.rootCause,
                workflow: result.entry.workflow,
                language: result.entry.language,
                provider: result.entry.provider,
                aiFallback: result.entry.aiFallback,
                promiseDate: result.entry.promiseDate
            },
            audit: result.entry
        });

    } catch (error) {
        console.error('Recovery error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// 1. Create Razorpay Order
router.post('/create-order', async (req, res) => {
    try {
        const { amount = 500, customer = 'Customer', lossType = 'PAYMENT_FAILURE', language = 'ENGLISH' } = req.body;
        const order = await createOrder(amount, 'INR', { customer, lossType, language });
        if (!order) {
            return res.status(500).json({ error: 'Failed to create order' });
        }
        res.json({
            success: true,
            orderId: order.id,
            amount: order.amount / 100,
            currency: order.currency,
            keyId: process.env.RAZORPAY_KEY_ID
        });
    } catch (error) {
        console.error('Create order error:', error);
        res.status(500).json({ error: error.message });
    }
});

router.post('/verify-payment', async (req, res) => {
    try {
        const { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: signature, amount = 500, customer = 'Customer' } = req.body;
        if (!verifyPaymentSignature(orderId, paymentId, signature)) {
            return res.status(400).json({ success: false, error: 'Invalid Razorpay payment signature' });
        }

        const payment = await fetchPayment(paymentId);
        const paymentStatus = payment?.status || 'captured';
        const recoveryEntry = paymentStatus === 'captured'
            ? recordSuccessfulPayment(amount, customer, paymentId)
            : null;
        res.json({
            success: true,
            paymentStatus,
            paymentId,
            orderId,
            payment,
            recoveryEntry
        });
    } catch (error) {
        console.error('Payment verification error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/webhook', async (req, res) => {
    try {
        const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body || {}));
        if (!verifyWebhookSignature(rawBody, req.headers['x-razorpay-signature'])) {
            return res.status(400).json({ success: false, error: 'Invalid Razorpay webhook signature' });
        }

        const event = JSON.parse(rawBody.toString('utf8'));
        const paymentEntity = event.payload?.payment?.entity || {};
        if (event.event === 'payment.failed') {
            const notes = paymentEntity.notes || {};
            await handleRecovery(
                notes.lossType || 'PAYMENT_FAILURE',
                Number(paymentEntity.amount || 0) / 100,
                notes.customer || paymentEntity.email || 'Customer',
                paymentEntity.error_description || 'Razorpay payment failed',
                { paymentId: paymentEntity.id, orderId: paymentEntity.order_id, language: notes.language || 'ENGLISH' }
            );
        }

        res.json({ received: true, event: event.event });
    } catch (error) {
        console.error('Razorpay webhook error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// 2. Simulate Payment (Success/Failure) + Trigger Agent
router.post('/simulate-payment', async (req, res) => {
    try {
        const { orderId, paymentId, status = 'failed', reason = 'Bank declined', amount = 500, customer = 'Test User', ...options } = req.body;

        // Simulate payment failure
        if (status === 'failed') {
            const result = await handleRecovery(
                'PAYMENT_FAILURE',
                amount,
                customer,
                reason,
                options
            );

            return res.json({
                success: true,
                paymentStatus: 'failed',
                recovery: {
                    action: result.analysis.action,
                    message: result.analysis.message,
                    rootCause: result.analysis.rootCause
                },
                audit: result.entry
            });
        }

        // Simulate payment success
        const recoveryEntry = recordSuccessfulPayment(amount, customer, paymentId);
        res.json({
            success: true,
            paymentStatus: 'success',
            message: 'Payment completed successfully.',
            recoveryEntry
        });

    } catch (error) {
        console.error('Simulate payment error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Metrics endpoint
router.get('/metrics', (req, res) => {
    res.json(getMetrics());
});

// Audit log endpoint
router.get('/audit', (req, res) => {
    res.json(getAuditLog());
});

router.get('/workflows', (req, res) => {
    res.json(getWorkflows());
});

router.get('/promises', (req, res) => {
    res.json(getPromises());
});

router.post('/reset-demo', (req, res) => {
    resetStore();
    res.json({ success: true, message: 'Demo data reset.' });
});

router.post('/batch-recover', async (req, res) => {
    try {
        const count = Math.min(Math.max(Number(req.body?.count || 10), 1), 20);
        const scenarios = [
            ['PAYMENT_FAILURE', 500, 'Aarav', 'Insufficient funds'],
            ['CHECKOUT_DROPOFF', 1800, 'Mira', 'Checkout abandoned after payment selection'],
            ['SUBSCRIPTION_FAILURE', 999, 'Kabir', 'Card expired during renewal'],
            ['OVERDUE_INVOICE', 45000, 'Acme Pvt Ltd', 'Invoice overdue by 14 days'],
            ['MANDATE_FAILURE', 2499, 'Neha', 'Auto-debit mandate failed'],
            ['PROMISE_TO_PAY', 12000, 'Orbit Systems', 'Customer promised payment by Friday']
        ];
        const results = [];
        for (let index = 0; index < count; index += 1) {
            const scenario = scenarios[index % scenarios.length];
            results.push(await handleRecovery(...scenario, {
                language: scenario[0] === 'PROMISE_TO_PAY' ? 'HINGLISH' : 'ENGLISH',
                retryCount: scenario[0] === 'MANDATE_FAILURE' ? 1 : 0,
                promiseDate: scenario[0] === 'PROMISE_TO_PAY' ? '2026-09-11' : undefined
            }));
        }
        const metrics = getMetrics();
        res.json({
            totalAttempted: results.length,
            totalRecovered: results.filter(result => result.analysis.action !== 'ESCALATE').length,
            recoveryRate: Math.round((results.filter(result => result.analysis.action !== 'ESCALATE').length / results.length) * 100),
            recoveredAmount: results.filter(result => result.analysis.action !== 'ESCALATE').reduce((sum, result) => sum + result.entry.amount, 0),
            workflows: [...new Set(results.map(result => result.entry.workflow))],
            metrics
        });
    } catch (error) {
        console.error('Batch recovery error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;