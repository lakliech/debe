/**
 * useIdentity — the signed-in caller's own record and the context they are
 * working in.
 *
 * Identity and campaign context are separate things. `/api/users/me` sits
 * outside the tenant boundary, so it answers for everybody: campaign staff,
 * users whose organisation is not registered yet, and platform operators who
 * administer every campaign but belong to none.
 *
 * A platform operator has NO campaign until they explicitly enter one, so
 * `activeTenant` is null for them by default. Callers must treat that as a
 * real state ("pick a campaign"), not as an error.
 */

import { useQuery } from "@tanstack/react-query";
import { useUser } from "@clerk/react";
import { deriveAccess, NO_ACCESS, type UserAccess } from "@/lib/access";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export interface ActiveTenant {
  id: string;
  name: string;
  slug: string;
  plan: string;
}

export interface Identity {
  /** The /api/users/me payload, or null while unresolved. */
  data: any | null;
  access: UserAccess;
  /** True for global admins — they operate across campaigns, never inside one by default. */
  isPlatformOperator: boolean;
  /** The campaign in context, or null (operator who has not entered one). */
  activeTenant: ActiveTenant | null;
  /** False while Clerk is still resolving or the request is in flight. */
  isLoaded: boolean;
  isSignedIn: boolean;
}

/** Shared query key so every consumer hits one cache entry, not one per component. */
export const identityQueryKey = (userId: string | null | undefined) => [
  "identity",
  userId ?? null,
];

export function useIdentity(): Identity {
  const { user, isSignedIn, isLoaded: clerkLoaded } = useUser();

  const { data, isError, isSuccess } = useQuery<any>({
    queryKey: identityQueryKey(user?.id),
    queryFn: () =>
      fetch(`${BASE}/api/users/me`, { credentials: "include" }).then((r) => {
        if (!r.ok) throw new Error(`/api/users/me ${r.status}`);
        return r.json();
      }),
    // Must NOT run before Clerk has established a session. An unauthenticated
    // call 401s, and because the result is cached, that failure would pin the
    // whole app at least privilege for the rest of the session.
    enabled: Boolean(clerkLoaded && isSignedIn),
    staleTime: 5 * 60 * 1000,
    retry: 2,
    retryDelay: 1_500,
  });

  if (!clerkLoaded) {
    return {
      data: null, access: NO_ACCESS, isPlatformOperator: false,
      activeTenant: null, isLoaded: false, isSignedIn: false,
    };
  }

  if (!isSignedIn) {
    return {
      data: null, access: { ...NO_ACCESS, isLoaded: true }, isPlatformOperator: false,
      activeTenant: null, isLoaded: true, isSignedIn: false,
    };
  }

  if (isSuccess && data) {
    return {
      data,
      access: deriveAccess(data),
      isPlatformOperator: Boolean(data.isPlatformOperator),
      activeTenant: (data.activeTenant as ActiveTenant | null) ?? null,
      isLoaded: true,
      isSignedIn: true,
    };
  }

  // Undecided (request in flight) is NOT the same as denied — keep isLoaded
  // false so the UI shows nothing rather than a wrong, reduced view it then
  // has to correct.
  return {
    data: null,
    access: isError ? { ...NO_ACCESS, isLoaded: true } : NO_ACCESS,
    isPlatformOperator: false,
    activeTenant: null,
    isLoaded: isError,
    isSignedIn: true,
  };
}
