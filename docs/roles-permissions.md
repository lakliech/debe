# Roles & Permissions Matrix

## Role Levels

Lower level = more privileged. Level 1 = Super Administrator.

| Level | Role Slug | Role Name | Description |
|---|---|---|---|
| 1 | `super-admin` | Super Administrator | Full platform access; can modify all settings |
| 2 | `campaign-exec-director` | Campaign Executive Director | Strategic oversight; all admin functions |
| 2 | `national-campaign-manager` | National Campaign Manager | National operations and coordination |
| 3 | `finance-manager` | Finance Manager | All financial operations; expenditure approval |
| 3 | `returning-officer` | Returning Officer | Final expenditure approval; results sign-off |
| 3 | `communications-officer` | Communications Officer | Statements, messaging, transparency |
| 3 | `legal-officer` | Legal Officer | Disputes, data protection, compliance |
| 3 | `data-officer` | Data Officer | Data protection, export, compliance |
| 4 | `county-coordinator` | County Coordinator | County-level operations and agents |
| 4 | `national-tally-verifier` | National Tally Verifier | National-level tally verification |
| 4 | `county-verification-officer` | County Verification Officer | County result verification |
| 5 | `agent-supervisor` | Agent Supervisor | Polling agent management |
| 6 | `polling-agent` | Polling Agent | Submit Form 34A results; view own station |
| 7 | `volunteer-coordinator` | Volunteer Coordinator | Manage volunteers in their area |
| 8 | `volunteer` | Volunteer | Basic access to volunteer resources |

## Permission Groups

### Finance
- `canApproveExpenditure`: `finance-manager`, `returning-officer`
- `canFinalApproveExpenditure`: `returning-officer`
- `canViewFinance`: above + `campaign-exec-director`, `national-campaign-manager`

### Election Results
- `canSubmitResults`: `polling-agent`, `agent-supervisor`, `county-coordinator`, `county-verification-officer`
- `canVerifyResults`: `county-verification-officer`, `national-tally-verifier`, `returning-officer`
- `canViewResults`: all authenticated users with any admin role

### Tally
- `canViewTally`: `requireAuth` only (no role restriction — transparency)

### Compliance & Data Protection
- `canViewCompliance`: `campaign-exec-director`, `data-officer`, `legal-officer`
- `canManageCompliance`: `campaign-exec-director`, `data-officer`, `legal-officer`

### Reporting & Exports
- `canExport`: `campaign-exec-director`, `national-campaign-manager`, `returning-officer`, `finance-manager`, `county-coordinator`, `data-officer`

### Privileged Access Review
- `canViewPrivilegedAccess`: `campaign-exec-director`, `super-admin`, `data-officer`

## Four-Eyes Principle

The following privilege groups must NOT be held simultaneously by the same user:

| Group A | Group B | Group C |
|---|---|---|
| Tally Verifiers (`national-tally-verifier`, `county-verification-officer`) | Payment Approvers (`finance-manager`, `returning-officer`) | Audit Managers (`campaign-exec-director`, `super-admin`) |

The `/privileged-access` page enforces this automatically.

## Separation of Duties

No single user may:
1. Alter verified results **AND** approve payments **AND** manage audit records
2. Submit results for a polling station they are not assigned to
3. Access export features without one of the listed export roles
