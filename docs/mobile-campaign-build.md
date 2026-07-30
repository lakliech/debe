# Building a per-campaign APK

This guide explains how a campaign operator creates a white-labelled Android
APK (or iOS IPA) that shows the correct candidate name, primary colour, and
logo on the sign-in screen — before the polling agent has even logged in.

---

## How it works

The mobile app reads `EXPO_PUBLIC_TENANT_SLUG` at **build time**.  Metro
bundler inlines the value into the compiled JavaScript bundle, so no network
lookup is needed to know which campaign this APK belongs to.

On first launch (before login) the app sends that slug as the
`X-Tenant-Slug` header when it fetches `/api/config/branding`.  The API
returns the campaign's candidate name, primary colour, logo URL, and election
level.  The sign-in screen renders them immediately.

After the agent signs in the JWT's Clerk org ID takes over, so if an agent
somehow installs a different campaign's APK their post-login experience is
still scoped to their own organisation.

---

## Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| Node.js | ≥ 20 | |
| pnpm | ≥ 9 | `npm i -g pnpm` |
| Expo CLI | latest | `pnpm add -g expo-cli` |
| EAS CLI | latest | `pnpm add -g eas-cli` |
| EAS account | — | `eas login` |

---

## Step 1 — Look up the campaign slug

Open the platform admin console → **Campaigns** → find your campaign.  The
slug is shown in the **Portal URL** column (e.g. `amina2027` from
`https://amina2027.ushindi.app`).

---

## Step 2 — Create a campaign env file

Copy the sample file and fill in your values:

```bash
cp artifacts/agent-mobile/.env.campaign artifacts/agent-mobile/.env.amina2027
```

Edit `.env.amina2027`:

```dotenv
EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_live_<your_clerk_key>
EXPO_PUBLIC_DOMAIN=api.ushindi.app
EXPO_PUBLIC_TENANT_SLUG=amina2027
```

> **Never commit campaign env files to source control.**  Add
> `.env.*` (except `.env.example` and `.env.campaign`) to `.gitignore`.

---

## Step 3 — Trigger the EAS build

```bash
# From the repo root
cd artifacts/agent-mobile

# Load the campaign-specific env vars and start the build
set -a && source .env.amina2027 && set +a

eas build \
  --platform android \
  --profile production \
  --non-interactive
```

EAS will bundle the current `EXPO_PUBLIC_TENANT_SLUG` value into the APK.

### iOS

```bash
eas build \
  --platform ios \
  --profile production \
  --non-interactive
```

---

## Step 4 — Verify the branding before distributing

1. Install the APK on a test device (or use the EAS Simulator build).
2. Open the app **without signing in**.
3. Confirm the sign-in screen shows:
   - The correct **candidate name** in the brand pill.
   - The campaign's **primary colour** on buttons and the brand pill.
   - The correct **election year**.

If you see "Campaign Agent" in grey the slug was not baked in correctly —
re-check your env file and rebuild.

---

## Step 5 — Distribute to agents

Use EAS Submit to upload directly to the Play Store / App Store, or
download the `.apk` / `.ipa` from the EAS dashboard and distribute via your
preferred MDM or direct-download link.

---

## Configuring `eas.json`

If you manage multiple campaigns, add a named EAS build profile per campaign
so you can trigger builds without manual env-file juggling:

```json
{
  "build": {
    "production": {
      "android": { "buildType": "apk" }
    },
    "amina2027": {
      "extends": "production",
      "env": {
        "EXPO_PUBLIC_TENANT_SLUG": "amina2027",
        "EXPO_PUBLIC_DOMAIN": "api.ushindi.app"
      }
    },
    "waweru-nairobi": {
      "extends": "production",
      "env": {
        "EXPO_PUBLIC_TENANT_SLUG": "waweru-nairobi",
        "EXPO_PUBLIC_DOMAIN": "api.ushindi.app"
      }
    }
  }
}
```

Then build with:

```bash
eas build --platform android --profile amina2027
```

> **`EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`** must be set as an EAS secret
> (not in `eas.json`) since it is specific to each Clerk instance:
> ```bash
> eas secret:create --name EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY --value pk_live_...
> ```

---

## Environment variable reference

| Variable | Required | Description |
|---|---|---|
| `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` | Yes | Clerk publishable key for this Clerk instance |
| `EXPO_PUBLIC_DOMAIN` | Yes | API server hostname (no scheme) |
| `EXPO_PUBLIC_TENANT_SLUG` | Campaign builds | Campaign slug — enables pre-login branding on the sign-in screen |
| `EXPO_PUBLIC_CLERK_PROXY_URL` | No | Custom Clerk proxy URL (leave blank for standard Clerk) |

See `artifacts/agent-mobile/.env.example` for annotated defaults.
