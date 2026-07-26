# Backup & Disaster Recovery

## Database Backups

### Automated Backups (Neon / Supabase)

If using a managed PostgreSQL provider (recommended):
- Neon: automatic daily backups with point-in-time recovery (PITR) to 7 days
- Supabase: daily backups with PITR on Pro tier

### Manual Backups

```bash
# Full database dump
pg_dump $DATABASE_URL > backup-$(date +%Y%m%d%H%M%S).sql

# Restore from dump
psql $DATABASE_URL < backup-20270810120000.sql
```

### Pre-Election Snapshot

Take a manual snapshot at:
- 48 hours before Election Day
- Close of polls (after all Form 34As submitted)
- After results are certified

## Recovery Procedures

### Scenario 1: API Server Down

1. Check workflow logs: `artifacts/api-server: API Server`
2. Restart the workflow
3. If persistent: check `DATABASE_URL` env var; verify DB connectivity
4. If DB unreachable: activate read-only mode (configure `READ_ONLY=true`)

### Scenario 2: Database Corruption

1. Stop the API server immediately
2. Identify the last clean backup timestamp
3. Restore from backup: `psql $DATABASE_URL < backup-TIMESTAMP.sql`
4. Review audit logs for any lost transactions
5. Notify all active agents to re-submit since the last clean state

### Scenario 3: Result Submission Data Loss

1. All agents have local copies of Form 34A images
2. Request re-submission from affected agents (offline-first app retains local state)
3. Re-submissions are versioned — the system tracks the correction history

### Scenario 4: Clerk Authentication Outage

1. Clerk maintains 99.99% uptime SLA
2. If Clerk is down: the API returns 401 for all protected routes
3. Workaround: agents can continue filling in offline (local storage) and submit when Clerk recovers

## Recovery Time Objectives

| Component | RTO | RPO |
|---|---|---|
| API Server | 5 minutes | 0 (stateless) |
| Database | 30 minutes | 1 hour (backup interval) |
| Election Day submission | 2 hours (worst case) | 0 (offline-first) |
| Tally dashboard | 15 minutes | 0 (computed from DB) |

## Contact for Recovery

- **Platform Admin**: super-admin account holder
- **Database Provider Support**: Neon / Supabase support portal
- **Clerk Support**: clerk.com/support
