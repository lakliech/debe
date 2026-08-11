# Billing Plans and Feature Gates

Every campaign (tenant) sits on one of three tiers. This document is the
human-readable half of `artifacts/api-server/src/lib/plans.ts`, which is the
single source of truth the middleware, the API responses, and the pricing page
all read from. Change the limits there, not here.

---

## The three tiers

| | **Free** | **Pro** | **Enterprise** |
|---|---|---|---|
| Price | KES 0 | KES 25,000 / month | Contact sales |
| Campaigns | 1 | 1 | Multi-campaign consultant access |
| Polling agents | 50 | Unlimited | Unlimited |
| Polling stations covered | 100 | Unlimited | Unlimited |
| Custom domain + HTTPS | — | ✅ | ✅ |
| Excel exports | — (CSV only) | ✅ | ✅ |
| Advanced reporting & tally analytics | — | ✅ | ✅ |
| White-label mobile build | — | — | ✅ |
| Dedicated support with election-day SLA | — | — | ✅ |

Free is sized for a ward or constituency race, Pro for county and national
campaigns running full election-day operations, Enterprise for presidential
campaigns and consultants operating several campaigns at once.

The public comparison of these tiers lives at `/pricing`, which reads
`GET /api/billing/plans` — the same catalogue — so the marketing page can never
drift from what the server enforces.

---

## Stored plan vs effective plan

`tenants.plan` is a `plan_tier` enum (`free | pro | enterprise`) and records
what the campaign **bought or was granted**. It is *not* what they may use
today:

- `tenants.plan_override_until` carries trials and manual grants. Once that
  timestamp passes, the campaign falls back to Free even though the column
  still reads `pro`.
- A Stripe subscription that lapses has the same effect.

Every entitlement decision therefore goes through `getEffectivePlan()`. Reading
`tenants.plan` directly is a bug: it either bills a campaign for something they
have lost, or hands a paid feature to a lapsed one.

---

## Server-side enforcement

Gating middleware lives in `artifacts/api-server/src/middlewares/requirePlan.ts`.

| Middleware | Use |
|---|---|
| `requirePlanFeature(feature)` | Whole route needs a paid feature |
| `requirePlanFeatureWhen(feature, predicate)` | Route serves a free and a paid variant (e.g. CSV vs Excel) |
| `requirePlanTier(tier)` | Route needs a minimum tier |
| `requireCapacity(limitKey, count, label)` | One-row create against a metered cap |
| `capacityViolation(...)` | Bulk insert — checks the whole batch against the remaining headroom |

A refusal answers **402 Payment Required** with a machine-readable body so the
client can prompt an upgrade in place instead of showing a generic error:

```json
{
  "error": "Excel exports require the Pro plan.",
  "feature": "excelExport",
  "currentPlan": "free",
  "requiredPlan": "pro",
  "upgradeUrl": "https://…/settings?tab=plan"
}
```

Capacity refusals add `current`, `limit`, and (for imports) `incoming`.

Currently gated:

- **Excel exports** — `POST /api/reporting/export` when `format: "excel"`. CSV
  stays available on Free.
- **Custom domains** — `PATCH /api/config/domain` and the
  `POST /api/settings/domain-requests` queue. *Clearing* a domain is always
  allowed, so a downgraded campaign can tidy up after losing the entitlement.
- **Polling-agent headcount** — `POST /api/polling-agents` and
  `POST /api/polling-agents/import`. The import path is checked against the
  whole batch, because a 500-row upload can jump a 50-agent cap in one request.
- **Polling-station coverage** — `PATCH /api/polling-stations-mgmt/stations/:id`
  and `POST /api/polling-stations-mgmt/stations/bulk-status`. Only stations the
  campaign has never profiled count against the cap: updating the status of a
  station already covered stays available at the cap, so a Free campaign is
  never locked out of maintaining the coverage it already has.

Gates fail **closed**. If a capacity count cannot be computed, the request is
refused with a retryable 503 rather than allowed — an earlier version allowed
it, and a broken counter silently removed the cap for every campaign. A 503 is
used rather than 402 because the campaign's plan is not the problem.

The platform super admin bypasses every gate (`lib/platformOverride.ts`): they
support and repair customer campaigns and must never have to change a
customer's billing to do it.

---

## Changing a campaign's plan

Platform operators change plans from **Platform Admin → tenant detail →
Billing Plan**, or from the Platform Billing dashboard. Both call
`PATCH /api/platform/tenants/:id/plan`, which:

- accepts `plan` (`free | pro | enterprise`) and, for paid tiers, `months`;
- records the grant as a `plan_override_until` expiry rather than an unlimited
  entitlement, so a comped campaign cannot silently keep Enterprise forever;
- clears the override when moving back to Free;
- writes a `platform.tenant.plan-change` audit record in the same transaction.

There is no self-service upgrade yet — the pricing page CTA is "contact us"
unless Stripe is configured for the deployment.

---

## In-app upgrade prompts

- `TrialBanner` speaks about **time** — trial ending, payment failed.
- `UpgradeBanner` speaks about **capacity** — it appears in the command centre
  once a capped campaign passes 80% of its agent cap ("48 of 50 polling agents
  used"), and again when the cap is reached. It reads
  `GET /api/billing/usage` and is dismissible per usage band, so crossing from
  "nearly full" to "full" speaks up again.

---

## Adding a new gated feature

1. Add the boolean to `PlanDefinition` and set it on all three tiers in
   `PLANS`, plus the `PlanFeature` union and `FEATURE_LABELS`.
2. Apply `requirePlanFeature("yourFeature")` to the route.
3. Add the bullet to the tier's `features` list so the pricing page explains
   what the customer is buying.
4. Cover it in `artifacts/api-server/tests/plan-gates.test.ts` — including the
   lapsed-grant case.
