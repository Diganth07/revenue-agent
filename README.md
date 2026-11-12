# Revenue Recovery Agent

An AI-assisted revenue recovery service for payment failures and receivables events. The configured AI provider recommends an action; the recovery service applies workflow policy, audit logging, and promise tracking.

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

1. Open **Payments** and start a hosted checkout using test credentials.
2. Review successful, failed, and dismissed attempts in **Audit & promises**.
3. Use **APIs & integrations** to review the registered routes and storage status.
4. Use the batch recovery API to exercise multiple workflows.

## API

- `POST /api/agent/recover` - run one recovery event
- `POST /api/agent/create-order` - create a hosted checkout order and audit entry
- `POST /api/agent/verify-payment` - verify and record a successful payment
- `POST /api/agent/checkout/:orderId/dismiss` - record a closed checkout
- `POST /api/agent/webhook` - receive signed payment events, including `payment.failed`
- `POST /api/agent/batch-recover` - run a multi-workflow demo batch
- `GET /api/agent/metrics` - recovery metrics
- `GET /api/agent/status` - registered API routes and integration readiness (never exposes secrets)
- `GET /api/agent/audit` - audit trail
- `GET /api/agent/promises` - promise-to-pay records
- `GET /api/agent/workflows` - supported playbooks
- `POST /api/agent/reset-demo` - clear local demo data

Local state is stored in the ignored `data/recovery-store.sqlite` SQLite database. On first startup, any existing `data/recovery-store.json` history is imported once and left in place as a backup. Set `RECOVERY_DB_PATH` to choose another database file. The built-in SQLite module requires Node.js 22.13 or newer.

Check the local SQLite file and recovery data with Python:

```powershell
py scripts\check_database.py
```

The checker opens the database read-only and verifies SQLite integrity, the recovery table, and the saved audit, promise, and metrics data.

Vercel's `/tmp` filesystem is temporary and is not shared between serverless instances. The status endpoint reports this as non-persistent; use a hosted database for durable history in a Vercel deployment. Payment retries and outbound notifications are currently simulated and audited; connect those action adapters before production use.

## Postman

Import the ready-to-use collection and environment from:

- `postman/collections/revenue-agent.postman_collection.json`
- `postman/environments/local.postman_environment.json`

Select **Revenue Agent - Local** and run **Agent health** followed by **Run Gemini recovery**.

## Hosted checkout

The dashboard's hosted checkout creates a real order. Use test credentials and test payment methods only. Configure a payment webhook pointing to:

```text
POST https://your-public-host/api/agent/webhook
```

Set the webhook secret in the matching environment variable from `.env.example`. The webhook verifies the signature and sends failed-payment events into the recovery agent.
