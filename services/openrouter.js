const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

function localRecoveryDecision(failureReason, amount, context) {
    const reason = failureReason.toLowerCase();
    const hinglish = context.language === 'HINGLISH';
    let action = 'NOTIFY';
    let rootCause = `Payment or receivable issue detected: ${failureReason}.`;

    if (context.workflow === 'Mandate retry sequencer') {
        action = Number(context.retryCount || 0) >= 2 ? 'ESCALATE' : 'RETRY';
        rootCause = 'The recurring mandate failed and should follow the configured retry sequence.';
    } else if (context.workflow === 'Checkout drop-off recovery') {
        action = 'OFFER_UPI';
        rootCause = 'The customer left checkout before completing payment.';
    } else if (context.workflow === 'Failed-subscription recovery') {
        action = reason.includes('expired') || reason.includes('declin') ? 'NOTIFY' : 'RETRY';
        rootCause = 'The subscription renewal could not complete with the current payment method.';
    } else if (context.workflow === 'B2B receivables chaser') {
        action = 'CHASE';
        rootCause = 'The business invoice is overdue and needs a structured receivables follow-up.';
    } else if (context.workflow === 'Promise-to-pay tracker') {
        action = 'TRACK_PROMISE';
        rootCause = 'The customer has committed to a payment date and should be tracked until settlement.';
    } else if (reason.includes('insufficient') || reason.includes('balance')) {
        action = 'NOTIFY';
        rootCause = 'The payment failed because the account has insufficient funds.';
    } else if (reason.includes('upi')) {
        action = 'OFFER_UPI';
        rootCause = 'The current payment path failed, so an alternate UPI method is appropriate.';
    }

    const message = hinglish
        ? `Namaste ${context.customer || 'Customer'}, ₹${amount} ka payment complete nahi ho saka. Kripya balance check karke dobara try karein.`
        : `Hello ${context.customer || 'Customer'}, your payment of ₹${amount} could not be completed. Please check your payment method and try again.`;

    return {
        action,
        message,
        rootCause,
        language: context.language || 'ENGLISH',
        provider: 'local-recovery-engine',
        fallback: true
    };
}

async function analyzeWithOpenRouter(failureReason, amount, context = {}) {
    if (process.env.AI_PROVIDER === 'local') {
        return localRecoveryDecision(failureReason, amount, context);
    }

    const geminiApiKey = process.env.GEMINI_API_KEY || process.env.gemini_api_key;
    if (process.env.AI_PROVIDER === 'gemini' || geminiApiKey) {
        return analyzeWithGemini(failureReason, amount, context, geminiApiKey);
    }

    try {
        if (!process.env.OPENROUTER_API_KEY) {
            throw new Error('OPENROUTER_API_KEY is not configured');
        }

        const languageInstruction = context.language === 'HINGLISH'
            ? 'Write the customer message in natural, polite Hinglish using simple Roman Hindi and English.'
            : 'Write the customer message in clear, polite English.';

        const prompt = `
You are an AI revenue recovery agent for a payment company.

Workflow: ${context.workflow || 'Payment failure'}
Customer: ${context.customer || 'Customer'}
Amount: ₹${amount}
Failure or receivable reason: "${failureReason}"
${context.retryCount ? `Previous retry attempts: ${context.retryCount}` : ''}
${context.dueDate ? `Due date: ${context.dueDate}` : ''}
${context.promiseDate ? `Promised payment date: ${context.promiseDate}` : ''}

Choose one action:
RETRY, NOTIFY, OFFER_UPI, ESCALATE, CHASE, TRACK_PROMISE

${languageInstruction}
Return exactly these three lines:
Action: <one action>
Message: <short customer message>
RootCause: <one-sentence explanation>
`;

        const response = await fetch(OPENROUTER_URL, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': process.env.OPENROUTER_SITE_URL || 'http://localhost:5000',
                'X-Title': process.env.OPENROUTER_APP_NAME || 'Revenue Recovery Agent'
            },
            body: JSON.stringify({
                model: process.env.OPENROUTER_MODEL || 'openrouter/auto',
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.5
            })
        });

        const payload = await response.json();
        if (!response.ok) {
            throw new Error(payload.error?.message || `OpenRouter request failed with ${response.status}`);
        }

        const text = payload.choices?.[0]?.message?.content || '';
        const actionMatch = text.match(/Action:\s*(.+)/i);
        const messageMatch = text.match(/Message:\s*(.+)/i);
        const rootCauseMatch = text.match(/RootCause:\s*(.+)/i);

        return {
            action: actionMatch ? actionMatch[1].trim().toUpperCase() : 'ESCALATE',
            message: messageMatch ? messageMatch[1].trim() : 'Please contact support.',
            rootCause: rootCauseMatch ? rootCauseMatch[1].trim() : 'Unable to determine reason.',
            language: context.language || 'ENGLISH',
            provider: 'openrouter',
            fallback: false
        };
    } catch (error) {
        console.error('OpenRouter error:', error.message);
        return localRecoveryDecision(failureReason, amount, context);
    }
}

async function analyzeWithGemini(failureReason, amount, context, apiKey) {
    try {
        if (!apiKey) throw new Error('GEMINI_API_KEY is not configured');

        const languageInstruction = context.language === 'HINGLISH'
            ? 'Write the customer message in natural, polite Hinglish using simple Roman Hindi and English.'
            : 'Write the customer message in clear, polite English.';
        const prompt = `
You are an AI revenue recovery agent for a payment company.

Workflow: ${context.workflow || 'Payment failure'}
Customer: ${context.customer || 'Customer'}
Amount: INR ${amount}
Failure or receivable reason: "${failureReason}"
${context.retryCount ? `Previous retry attempts: ${context.retryCount}` : ''}
${context.dueDate ? `Due date: ${context.dueDate}` : ''}
${context.promiseDate ? `Promised payment date: ${context.promiseDate}` : ''}

Choose one action: RETRY, NOTIFY, OFFER_UPI, ESCALATE, CHASE, TRACK_PROMISE
${languageInstruction}
Return exactly these three lines:
Action: <one action>
Message: <short customer message>
RootCause: <one-sentence explanation>
`;

        const model = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
        const response = await fetch(`${GEMINI_URL}/${model}:generateContent?key=${encodeURIComponent(apiKey)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        });
        const payload = await response.json();
        if (!response.ok) {
            throw new Error(payload.error?.message || `Gemini request failed with ${response.status}`);
        }

        const text = payload.candidates?.[0]?.content?.parts?.map(part => part.text || '').join(' ') || '';
        const actionMatch = text.match(/Action:\s*(.+)/i);
        const messageMatch = text.match(/Message:\s*(.+)/i);
        const rootCauseMatch = text.match(/RootCause:\s*(.+)/i);

        return {
            action: actionMatch ? actionMatch[1].trim().toUpperCase() : 'ESCALATE',
            message: messageMatch ? messageMatch[1].trim() : 'Please contact support.',
            rootCause: rootCauseMatch ? rootCauseMatch[1].trim() : 'Unable to determine reason.',
            language: context.language || 'ENGLISH',
            provider: 'gemini',
            fallback: false
        };
    } catch (error) {
        console.error('Gemini error:', error.message);
        return localRecoveryDecision(failureReason, amount, context);
    }
}

module.exports = { analyzeWithOpenRouter };