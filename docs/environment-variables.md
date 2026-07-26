# Environment Variables

Copy `.env.example` and fill in the values below.

## Required

| Variable | Description | Example |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string | `postgres://user:pass@host:5432/linda` |
| `CLERK_PUBLISHABLE_KEY` | Clerk publishable key (API server) | `pk_test_...` |
| `CLERK_SECRET_KEY` | Clerk secret key (API server only — never expose) | `sk_test_...` |
| `VITE_CLERK_PUBLISHABLE_KEY` | Clerk publishable key (frontend Vite env) | `pk_test_...` |

## Optional / Storage

| Variable | Description | Default |
|---|---|---|
| `DEFAULT_OBJECT_STORAGE_BUCKET_ID` | GCS bucket for file uploads | none |
| `PRIVATE_OBJECT_DIR` | GCS path prefix for private uploads | none |
| `PUBLIC_OBJECT_SEARCH_PATHS` | Comma-separated GCS paths for public search | none |

## Optional / Security

| Variable | Description | Default |
|---|---|---|
| `CORS_ORIGINS` | Comma-separated allowed origins | Replit preview domain + localhost |
| `SESSION_SECRET` | Session signing secret | none (Clerk sessions are JWT-based) |
| `PORT` | API server port | `8080` |

## Optional / M-Pesa

| Variable | Description |
|---|---|
| `MPESA_CONSUMER_KEY` | Safaricom M-Pesa consumer key (enables live mode) |
| `MPESA_CONSUMER_SECRET` | M-Pesa consumer secret |
| `MPESA_SHORTCODE` | Paybill shortcode (3033049) |
| `MPESA_PASSKEY` | M-Pesa passkey for STK Push |
| `MPESA_CALLBACK_URL` | Publicly accessible URL for M-Pesa callbacks |

## Node.js environment

| Variable | Description | Values |
|---|---|---|
| `NODE_ENV` | Runtime environment | `development` \| `production` |
