const Razorpay = require('razorpay');
const crypto = require('crypto');

function getRazorpayClient() {
    const missing = [];
    if (!process.env.RAZORPAY_KEY_ID) missing.push('RAZORPAY_KEY_ID');
    if (!process.env.RAZORPAY_KEY_SECRET) missing.push('RAZORPAY_KEY_SECRET');
    if (missing.length > 0) {
        throw new Error(`Missing Razorpay environment variables: ${missing.join(', ')}`);
    }

    return new Razorpay({
        key_id: process.env.RAZORPAY_KEY_ID,
        key_secret: process.env.RAZORPAY_KEY_SECRET
    });
}

async function createOrder(amount, currency = 'INR', notes = {}) {
    try {
        const razorpay = getRazorpayClient();
        const options = {
            amount: amount * 100,  // paise
            currency,
            receipt: `receipt_${Date.now()}`,
            notes
        };
        const order = await razorpay.orders.create(options);
        return order;
    } catch (error) {
        console.error('Razorpay order error:', error);
        throw error;
    }
}

async function fetchPayment(paymentId) {
    try {
        const razorpay = getRazorpayClient();
        return await razorpay.payments.fetch(paymentId);
    } catch (error) {
        console.error('Razorpay fetch error:', error);
        return null;
    }
}

function verifyPaymentSignature(orderId, paymentId, signature) {
    const expected = crypto
        .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET || '')
        .update(`${orderId}|${paymentId}`)
        .digest('hex');
    const received = Buffer.from(signature || '');
    const expectedBuffer = Buffer.from(expected);
    return received.length === expectedBuffer.length && crypto.timingSafeEqual(expectedBuffer, received);
}

function verifyWebhookSignature(rawBody, signature) {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET || process.env.RAZORPAY_KEY_SECRET || '';
    const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    const received = Buffer.from(signature || '');
    const expectedBuffer = Buffer.from(expected);
    return received.length === expectedBuffer.length && crypto.timingSafeEqual(expectedBuffer, received);
}

module.exports = { createOrder, fetchPayment, verifyPaymentSignature, verifyWebhookSignature };