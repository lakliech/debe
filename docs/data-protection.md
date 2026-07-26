# Data Protection & GDPR Compliance Guide

The Linda Mwananchi platform processes personal data for campaign operations. This document describes the data protection framework, compliance registers, and subject rights processes.

## Legal Basis Summary

| Data Category | Legal Basis | Retention |
|---|---|---|
| Volunteers | Consent | 3 years post-campaign |
| Supporters (CRM) | Legitimate interest | 3 years post-campaign |
| Donors | Legal obligation (financial records) | 7 years |
| Polling Agents | Contract | 5 years post-election |
| Election Results | Legal obligation (electoral records) | 10 years |
| Audit Logs | Legal obligation (accountability) | 10 years (non-deletable) |
| Financial records | Legal obligation (KRA/EACC) | 7 years |

## Data Subject Rights (GDPR Articles 15–22)

The platform supports all data subject rights with a 30-day response deadline (per Article 12):

| Right | How to submit | Platform workflow |
|---|---|---|
| Access (Article 15) | `/data-request` public form | DSR created → assigned → response within 30 days |
| Correction (Article 16) | `/data-request` public form | DSR created → admin corrects record → marks complete |
| Deletion (Article 17) | `/data-request` public form | DSR created → legal review → approved deletion |
| Portability (Article 20) | `/data-request` public form | Data exported as JSON/CSV and delivered |
| Restriction (Article 18) | `/data-request` public form | DSR created → account restricted |
| Consent withdrawal | `/data-request` public form or contact | Consent audit record updated |

### Admin Workflow

1. Navigate to `/compliance` → **Data Subject Requests** tab
2. New request appears with 30-day deadline automatically set
3. Assign to a team member using "Start Review"
4. Complete the request and add completion notes
5. All actions are logged in the consent audit trail

## Consent Management

Consent is collected at registration for:
- **Marketing communications** (email, SMS, WhatsApp)
- **Data processing** for campaign analysis
- **Third-party sharing** (explicit, per contact channel)

Consent records are stored in `consent_audit` table with:
- Timestamp and IP address at point of consent
- Exact checkbox/label text shown to user
- Any subsequent withdrawals

## DPIA Register

A Data Protection Impact Assessment is required before processing:
- Sensitive personal data (health, biometrics)
- Data from vulnerable individuals
- Systematic monitoring at scale
- Cross-border transfers without adequacy decisions

Navigate to `/compliance` → **DPIAs** tab to create and manage assessments.

## Vendor Register

All third-party processors must be registered. Current vendors:

| Vendor | Type | Transfer Mechanism |
|---|---|---|
| Clerk | SaaS (Auth) | SCCs |
| PostgreSQL (Neon) | Cloud DB | SCCs |
| Google Cloud Storage | Cloud Storage | SCCs |
| Safaricom M-Pesa | Payment | Adequacy (Kenya) |

Navigate to `/compliance` → **Vendors** tab to manage.

## Data Breach Response

If a breach is discovered:
1. Log immediately at `/compliance` → **Breach Register** tab
2. Assess severity and affected records
3. **Critical/High**: notify the Data Protection Commissioner within 72 hours
4. Click "Notify DPA" to log the notification timestamp
5. Notify affected subjects if the breach risks their rights and freedoms
6. Document root cause and remedial actions

## Retention Policy Engine

Retention policies are configurable at `/compliance` → **Retention Policies** tab.
Auto-delete is deliberately disabled by default — all deletions require human review.

## Privacy Notice

Users are notified via:
- Registration form with explicit consent checkboxes
- Platform privacy notice linked from all public pages
- Cookie consent banner on first visit
