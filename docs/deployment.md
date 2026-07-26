# Deployment Guide

## Platform: Replit Deployments

The platform is deployed via Replit's built-in deployment system.

### Prerequisites

- All environment variables set in Replit Secrets
- Database provisioned and `DATABASE_URL` configured
- Clerk production keys set (`CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `VITE_CLERK_PUBLISHABLE_KEY`)

### Deploy

1. In Replit, click **Deploy** (or **Publish**)
2. The platform builds and deploys automatically
3. The API server and frontend are served from the same domain

### Production Environment Variables

Set these in Replit Secrets before deploying:

```
DATABASE_URL=postgres://...
CLERK_PUBLISHABLE_KEY=pk_live_...
CLERK_SECRET_KEY=sk_live_...
VITE_CLERK_PUBLISHABLE_KEY=pk_live_...
DEFAULT_OBJECT_STORAGE_BUCKET_ID=...   (if using file uploads)
SESSION_SECRET=<random 32-byte hex>
NODE_ENV=production
```

### Post-Deploy Steps

1. Run DB migrations (do not use `push` in production):
```bash
pnpm --filter @workspace/db exec drizzle-kit migrate
```

2. Verify health endpoint: `GET /api/healthz`

3. Create the first super-admin account via `/sign-up`, then set the role directly in the DB:
```sql
INSERT INTO user_roles (user_id, role_id)
SELECT u.id, r.id FROM users u, roles r
WHERE u.clerk_id = '<clerk-user-id>' AND r.slug = 'super-admin';
```

### Checking Production Logs

In Replit → Deployments → Logs tab. Or use the `deployment` skill to access logs programmatically.

### Rolling Back

1. In Replit → Deployments → select a previous checkpoint
2. Or: restore from the database backup if schema changes need reverting

### Production Checklist

- [ ] `NODE_ENV=production` is set
- [ ] Clerk production keys (not test keys) are configured
- [ ] `DATABASE_URL` points to the production database
- [ ] HSTS is enabled (Helmet sets this automatically when NODE_ENV=production)
- [ ] Rate limits are appropriate for expected traffic
- [ ] Audit log retention policy is configured
- [ ] Backup procedure is verified
- [ ] Admin accounts are created with production Clerk users (not dev accounts)
