/**
 * Clerk Backend API helpers.
 *
 * @clerk/backend is not a direct dependency, so admin-plane calls (creating
 * organisations, inviting members) go through the REST API with the secret key.
 *
 * Shared by the platform-admin routes and the self-serve registration flow so
 * both create organisations identically.
 */

const CLERK_API = "https://api.clerk.com/v1";

/**
 * True when running without Clerk Organizations enabled (local dev).
 * Set CLERK_ORGS_DISABLED=true to use stub org IDs.
 */
export function clerkOrgsDisabled(): boolean {
  return process.env.CLERK_ORGS_DISABLED === "true";
}

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

export function clerkPost(path: string, body: Record<string, unknown>) {
  return clerkRequest("POST", path, body);
}

export function clerkGet(path: string) {
  return clerkRequest("GET", path);
}

export function clerkDelete(path: string) {
  return clerkRequest("DELETE", path);
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
