# Election Day Operations Guide

## Overview

This guide is for county coordinators, command centre operators, and national campaign managers managing the election day workflow from the Linda Mwananchi Command Centre.

---

## Pre-Election Day Setup

### 48 Hours Before

1. **Confirm agent deployment**: `/polling-agents` — all stations should have `accredited` agents with `completed` training
2. **Activate the election**: `/election-admin` → set election status to `active` and `isActive = true`
3. **Verify connectivity**: confirm agents have app access on their devices
4. **Briefing call**: coordinate with all county coordinators
5. **Command Centre staffing**: assign shifts at the Command Centre `/command-centre`

### Day Before

1. Check all agents have completed Code of Conduct (`codeOfConductAccepted = true`)
2. Ensure Form 34A templates are distributed
3. Confirm emergency contact lists are circulated
4. Test the submission pipeline with a test station

---

## Election Day Timeline

| Time | Action |
|---|---|
| 05:00 | Command Centre opens; all staff on standby |
| 06:00 | Polling stations open; agent check-in begins |
| 06:30 | First reporting sweep: confirm agents at stations |
| 09:00 | Mid-morning status check; escalate any incidents |
| 12:00 | Midday incident review; update county coordinators |
| 15:00 | Pre-close sweep: confirm all agents still in place |
| 17:00 | Stations close; counting begins |
| 18:00+ | Results submission window opens |
| Ongoing | Monitor `/tally` dashboard as results come in |

---

## Command Centre Dashboard

Navigate to `/command-centre` for:

- **Real-time coverage map**: stations reporting vs outstanding
- **Live tally**: national and county-level totals as they are verified
- **Active incidents**: filter by severity and county
- **Agent status board**: who has submitted, who has connectivity issues

---

## Results Flow

1. **Agent submits** Form 34A via `/agent/results`
2. **Auto-validation**: arithmetic check (candidate votes + rejected = total)
   - PASS → status: `auto_validated`
   - FAIL → status: `exception` → flags for county review
3. **County Verification Officer** reviews and verifies at `/election-results`
4. **National Tally Verifier** performs second-tier verification
5. **Legal review** for any queried submissions
6. **Verified**: final status; cannot be altered

### Exception Handling

If a submission fails auto-validation:
1. Go to `/election-results` → filter by `exception`
2. Open the submission detail — flags are listed
3. Contact the polling agent to clarify
4. If Form 34A image confirms the figure, correct and proceed
5. All corrections are logged with who made them and when

---

## Incident Escalation

| Severity | Response Time | Escalation Path |
|---|---|---|
| Low | 4 hours | County Coordinator |
| Medium | 2 hours | County Coordinator → National Manager |
| High | 30 minutes | National Manager → Legal Officer |
| Critical | Immediate | Executive Director + Legal + Command Centre |

Navigate to `/election-incidents` to manage all incidents.

---

## Transparency Portal

During counting, publish official result updates at `/transparency-portal`:
- Upload verified Form 34A scans
- Post county-by-county tallies as they are confirmed
- Communications Officer must approve before public posting

---

## Post-Election

1. Mark election as `completed` in `/election-admin` once final results are certified
2. Run the Tally Summary report (`/reporting`) for the official record
3. Export the full audit log
4. Archive agent accreditation records
5. Begin DSR review period (30 days for any data subject requests)
