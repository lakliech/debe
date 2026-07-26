# Administrator Guide

## Getting Started as an Administrator

After your account is created, you will need the `super-admin` or `campaign-exec-director` role assigned to access all features.

### First-Time Setup Checklist

- [ ] Configure branding at `/settings/branding` (logo, colours, tagline)
- [ ] Set system configuration at `/settings/system`
- [ ] Create the active election at `/election-admin`
- [ ] Import geography (counties are pre-seeded; add constituencies/wards as needed at `/geography`)
- [ ] Set up user accounts for all campaign staff at `/users`
- [ ] Assign roles at `/roles`
- [ ] Run the seed script for demo data (development only)

---

## User Management (`/users`)

- Create users: they must first sign up via Clerk (`/sign-up`), then you assign roles
- View all users, filter by role
- Suspend accounts via the user detail page
- All role changes are logged to the audit trail

## Role Management (`/roles`)

- View all roles and their permission levels
- Assign roles to users: select a user → select a role → save
- Remove roles: click the role assignment → remove
- Always verify four-eyes compliance after role changes (`/privileged-access`)

## Election Administration (`/election-admin`)

- Create an election with name, year, date
- Set `isActive = true` for the current election (only one active election at a time)
- Add presidential candidates (with ballot position and `isOurCandidate` flag)
- Set election status: `upcoming` → `active` → `completed`

## Audit Log (`/audit`)

- Filter by action type, user, date range
- Records are immutable — no deletion possible
- Export via `/reporting` → Audit Log report

## Data Protection (`/compliance`)

- Full GDPR compliance register
- Manage data subject requests, DPIAs, vendor register, breach register, retention policies
- See [data-protection.md](data-protection.md) for full guidance

## Reporting (`/reporting`)

- Download any of 19 report types as CSV or Excel
- All downloads are logged to the export audit trail
- Role-restricted: only authorised roles can export

## Privileged Access Review (`/privileged-access`)

Run this check regularly (weekly during campaign, daily on election day) to ensure no user holds conflicting privileges:
- Tally verification + payment approval + audit management must be held by different people

---

## Emergency Actions

### Suspend an Agent

1. `/polling-agents` → find the agent
2. Open detail → Change status to `suspended`
3. Their result submissions are flagged for review

### Lock Down Exports

Set `canExport` roles in the RBAC configuration and remove the role from any user temporarily.

### Roll Back a Result Submission

1. `/election-results` → open the submission
2. Click "Request Correction" (requires national-tally-verifier or returning-officer)
3. Enter reason and corrected values
4. Second officer must co-approve
