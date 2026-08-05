/**
 * Clerk Backend API helpers — identity lookups only.
 *
 * Clerk owns WHO a user is (accounts, verified email addresses); the app owns
 * campaign membership (user_roles). There are deliberately no organisation
 * helpers here: Clerk Organisations is not part of the access model.
 *
 * @clerk/backend is not a direct dependency, so lookups go through the REST
 * API with the secret key.
 */

const CLERK_API = "https://api.clerk.com/v1";

async function clerkRequest(method: string, path: string, body?: Record<string, unknown>) {
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) throw new Error("CLERK_SECRET_KEY is not set");

  const res = await fetch(`${CLERK_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Surface the full Clerk error for easier debugging
    const clerkMsg =
      json?.errors?.[0]?.long_message ?? json?.errors?.[0]?.message ?? JSON.stringify(json);
    throw new Error(`Clerk ${res.status}: ${clerkMsg}`);
  }
  return json;
}

export function clerkGet(path: string) {
  return clerkRequest("GET", path);
}

/** Primary email address for a Clerk user, or null. */
export async function clerkUserEmail(clerkUserId: string): Promise<string | null> {
  try {
    const user: any = await clerkGet(`/users/${clerkUserId}`);
    const primaryId = user?.primary_email_address_id;
    const addresses: any[] = user?.email_addresses ?? [];
    const primary = addresses.find((a) => a.id === primaryId) ?? addresses[0];
    return primary?.email_address ?? null;
  } catch {
    return null;
  }
}

/**
 * The user's primary email, but only if Clerk has verified it.
 *
 * Use this — never the local users.email column — for any decision that grants
 * privilege. The local column can be written from request data (campaign
 * registration accepts a contact email), so treating it as proof of identity
 * would let a caller claim someone else's address.
 */
export async function clerkVerifiedPrimaryEmail(
  clerkUserId: string,
): Promise<string | null> {
  try {
    const user: any = await clerkGet(`/users/${clerkUserId}`);
    const primaryId = user?.primary_email_address_id;
    const addresses: any[] = user?.email_addresses ?? [];
    const primary = addresses.find((a) => a.id === primaryId);
    if (!primary) return null;
    if (primary.verification?.status !== "verified") return null;
    return primary.email_address ?? null;
  } catch {
    return null;
  }
}

/**
 * Clerk user IDs holding a given email address.
 *
 * Clerk is the source of truth for who owns an address, so the platform
 * bootstrap resolves its allowlist through here rather than searching local
 * rows by email.
 */
export async function clerkUserIdsByEmail(email: string): Promise<string[]> {
  try {
    const users: any = await clerkGet(
      `/users?email_address=${encodeURIComponent(email)}&limit=10`,
    );
    const list: any[] = Array.isArray(users) ? users : (users?.data ?? []);
    return list.map((u) => u?.id).filter((id): id is string => typeof id === "string");
  } catch {
    return [];
  }
}

/** Display name for a Clerk user, or null. */
export async function clerkUserName(clerkUserId: string): Promise<string | null> {
  try {
    const user: any = await clerkGet(`/users/${clerkUserId}`);
    const name = [user?.first_name, user?.last_name].filter(Boolean).join(" ").trim();
    return name || user?.username || null;
  } catch {
    return null;
  }
}
