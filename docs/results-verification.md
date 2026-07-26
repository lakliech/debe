# Results Verification Guide

## Verification State Machine

Every result submission follows a strict linear workflow. No stage may be skipped.

```
draft → submitted → auto_validated → constituency_verification
                ↘ exception → polling_centre_review ↗

constituency_verification → county_verification → national_verification → legal_review → verified
      ↕ constituency_queried           ↕ county_queried
```

### States

| State | Description | Who can act |
|---|---|---|
| `draft` | Agent entered data, not yet submitted | Polling Agent |
| `submitted` | Agent submitted; awaiting arithmetic validation | System |
| `auto_validated` | Arithmetic check passed | System |
| `exception` | Arithmetic mismatch or overvote flagged | County Verification Officer |
| `polling_centre_review` | Polling centre presiding officer reviewing | Presiding Officer |
| `constituency_verification` | Constituency RO verified | County Verification Officer |
| `constituency_queried` | Query raised at constituency level | County Verification Officer |
| `county_verification` | County RO verified | National Tally Verifier |
| `county_queried` | Query raised at county level | National Tally Verifier |
| `national_verification` | National tally team verified | National Tally Verifier |
| `legal_review` | Legal officer signing off | Legal Officer |
| `verified` | **Final — immutable** | — |

---

## Arithmetic Validation Rules

Every submission must satisfy:
```
sum(candidateVotes) + rejectedBallots = totalVotes
totalVotes ≤ registeredVoters
all(candidateVotes) ≥ 0
rejectedBallots ≥ 0
```

Failures automatically flag the submission as `exception`.

---

## Handling Exceptions

1. Navigate to `/election-results` → filter `Status: exception`
2. Open the submission — flags are displayed prominently
3. View the Form 34A image attachment
4. **If image matches the entry**: select "Verify override" with a note
5. **If image contradicts the entry**: contact the polling agent; request a correction submission
6. Every override is logged: who approved, when, reason

---

## Corrections

If a verified figure needs correction after verification:
1. Only `national-tally-verifier` or `returning-officer` can initiate corrections
2. Navigate to the submission detail → "Request Correction"
3. Enter the old value, new value, and reason
4. A second officer must co-approve (four-eyes)
5. The correction history is immutable and displayed on the submission detail

---

## Tally Dashboard

Real-time tally at `/tally`:

- **National view**: total votes per candidate, reporting percentage
- **Drill down** to county → constituency → ward → station level
- All tallies are computed live from `verified` and `auto_validated` submissions
- Unverified submissions are excluded from the official tally

---

## Anti-Fraud Controls

1. **Duplicate detection**: if the same station submits twice, the system flags it
2. **Overvote detection**: `totalVotes > registeredVoters` triggers an exception
3. **Arithmetic check**: automated on every submission
4. **Correction history**: every change is timestamped and attributed
5. **Four-eyes on corrections**: no single user can alter a verified result unilaterally
6. **Image evidence**: Form 34A photo required for all submissions
7. **Audit log**: every action is logged to the immutable `audit_logs` table
