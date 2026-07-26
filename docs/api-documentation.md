# API Documentation

The Linda Mwananchi API is an Express 5 server with OpenAPI 3.0 documentation.

**Base URL**: `/api`

## Authentication

All protected endpoints require a Clerk JWT in the `Authorization` header or cookie:

```
Authorization: Bearer <clerk_jwt>
```

Or via the Clerk session cookie (set automatically by the browser after sign-in).

## Route Groups

| Prefix | Description |
|---|---|
| `/api/users` | User management |
| `/api/roles` | Role and permission management |
| `/api/geography` | Counties, constituencies, wards, polling stations |
| `/api/dashboard` | Dashboard summary metrics |
| `/api/volunteers` | Volunteer registration and management |
| `/api/supporters` | Supporter CRM |
| `/api/training` | Training courses and enrollments |
| `/api/finance` | Contributions, budget, expenditure |
| `/api/communications` | Messages, templates, statements |
| `/api/content` | Content library assets |
| `/api/events-mgmt` | Event management |
| `/api/rapid-response` | Fact-checking and rapid response |
| `/api/election-admin` | Election configuration |
| `/api/polling-stations-mgmt` | Polling station management |
| `/api/polling-agents` | Agent management and training |
| `/api/election-results` | Result submission workflow |
| `/api/tally` | Tally dashboard data |
| `/api/election-incidents` | Election incident reporting |
| `/api/election-disputes` | Dispute management |
| `/api/transparency` | Transparency portal publications |
| `/api/command-centre` | Command centre dashboard |
| `/api/reporting` | CSV/Excel report downloads |
| `/api/compliance` | Data protection registers |
| `/api/privileged-access` | Four-eyes privilege review |
| `/api/audit` | Audit log viewer |
| `/api/public` | Public portal (no auth required) |
| `/api/data-requests` | Public data subject requests |
| `/api/storage` | File upload URLs |

## Key Endpoints

### GET /api/elections/active
Returns the currently active election. No role restriction — available to all authenticated users.

### POST /api/reporting/export
Downloads a report. Requires export role. Logs download to `export_audit_log`.

**Body:**
```json
{
  "reportId": "volunteers",
  "format": "csv",
  "filters": {}
}
```

### GET /api/tally/national
Returns national tally summary. Requires `requireAuth` (any role).

### GET /api/compliance/dashboard
Returns compliance dashboard metrics. Requires compliance roles.

### POST /api/compliance/breaches
Logs a data breach. Requires compliance management role.

## Error Responses

All errors return JSON:
```json
{ "error": "Description of the error" }
```

| Status | Meaning |
|---|---|
| 400 | Bad request — invalid input |
| 401 | Unauthorized — missing or invalid JWT |
| 403 | Forbidden — insufficient role |
| 404 | Not found |
| 429 | Rate limit exceeded |
| 500 | Internal server error |

## OpenAPI Spec

The full OpenAPI 3.0 spec is in `lib/api-spec/openapi.yaml`.

To regenerate the TypeScript client and Zod schemas:
```bash
pnpm --filter @workspace/api-spec run codegen
```
