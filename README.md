# Revenue Recovery Agent

An AI revenue recovery control plane for Razorpay payment and receivables events. Gemini analyzes failures and recommends the next action; the recovery service applies workflow policy, audit logging, and promise tracking.

## Run locally

```powershell
npm install
npm start
```

Open `http://localhost:5000/`. The dashboard is served by the Express backend, so its API calls and UI use the same origin.

Create `.env` from `.env.example` and add your credentials:

```env
GEMINI_API_KEY=your_gemini_api_key
GEMINI_MODEL=gemini-3.6-flash
AI_PROVIDER=gemini
RAZORPAY_KEY_ID=your_razorpay_key_id
RAZORPAY_KEY_SECRET=your_razorpay_key_secret
RAZORPAY_WEBHOOK_SECRET=your_razorpay_webhook_secret
```

The local recovery engine remains available as a fallback when Gemini is unavailable.

## Demo flow

1. Open the dashboard and use **Live Event Simulator** to trigger a recovery workflow.
2. Use the Razorpay test checkout to see the Gemini recovery intervention after a failed payment.
3. Select **Hinglish voice** to hear the customer message from the audit trail.
4. Run the batch recovery endpoint to exercise multiple workflows at once.

## API

- `POST /api/agent/recover` - run one recovery event
- `POST /api/agent/create-order` - create a Razorpay test-mode order
- `POST /api/agent/verify-payment` - verify a successful Razorpay Checkout payment
- `POST /api/agent/webhook` - receive signed Razorpay events, including `payment.failed`
- `POST /api/agent/batch-recover` - run a multi-workflow demo batch
- `GET /api/agent/metrics` - recovery metrics
- `GET /api/agent/audit` - audit trail
- `GET /api/agent/promises` - promise-to-pay records
- `GET /api/agent/workflows` - supported playbooks
- `POST /api/agent/reset-demo` - clear local demo data

Generated local state is stored in `data/recovery-store.json` and is ignored by Git. Payment retries and outbound notifications are currently simulated and audited; connect those action adapters before production use.

## Postman

Import the ready-to-use collection and environment from:

- `postman/collections/revenue-agent.postman_collection.json`
- `postman/environments/local.postman_environment.json`

Select **Revenue Agent - Local** and run **Agent health** followed by **Run Gemini recovery**.

## Razorpay test mode

The dashboard's **Razorpay Test Checkout** creates a real test-mode order. Use Razorpay test credentials and test cards only. Configure a Razorpay webhook pointing to:

```text
POST https://your-public-host/api/agent/webhook
```

Set the same webhook secret in `RAZORPAY_WEBHOOK_SECRET`. The webhook verifies the signature and sends `payment.failed` events into the recovery agent.
