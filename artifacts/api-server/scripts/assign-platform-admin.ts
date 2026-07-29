#!/usr/bin/env tsx
/**
 * One-time script: assign the platform_admin role to a user by their Clerk ID.
 *
 * Usage:
 *   pnpm --filter @workspace/api-server tsx scripts/assign-platform-admin.ts user_2abc123
 *
 * The platform_admin role has level 0 (above all campaign roles). It is
 * assigned with tenantId = NULL so it applies cross-tenant. The user must
 * already have a row in the `users` table (i.e. must have signed in at least once).
 */

import { db, usersTable, userRolesTable, rolesTable } from "@workspace/db";
import { eq } from "drizzle-orm";

async function main() {
  const clerkId = process.argv[2];
  if (!clerkId) {
    console.error("Usage: assign-platform-admin.ts <clerk_user_id>");
    console.error("  e.g. assign-platform-admin.ts user_2abc123xyz");
    process.exit(1);
  }

  // 1. Resolve local user
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.clerkId, clerkId))
    .limit(1);

  if (!user) {
    console.error(`No local user found for Clerk ID '${clerkId}'.`);
    console.error("The user must sign in at least once before being granted this role.");
    process.exit(1);
  }

  // 2. Find platform_admin role
  const [role] = await db
    .select()
    .from(rolesTable)
    .where(eq(rolesTable.slug, "platform_admin"))
    .limit(1);

  if (!role) {
    console.error("platform_admin role not found in the database.");
    console.error("Run migrations to ensure migration 0017 has been applied.");
    process.exit(1);
  }

  // 3. Check for existing assignment
  const [existing] = await db
    .select()
    .from(userRolesTable)
    .where(eq(userRolesTable.userId, user.id))
    .limit(1);

  if (existing) {
    // Check if they already have platform_admin specifically
    const allRoles = await db
      .select({ roleId: userRolesTable.roleId })
      .from(userRolesTable)
      .where(eq(userRolesTable.userId, user.id));

    const alreadyAssigned = allRoles.some((r) => r.roleId === role.id);
    if (alreadyAssigned) {
      console.log(`✓ User '${user.fullName}' (${clerkId}) already has platform_admin.`);
      process.exit(0);
    }
  }

  // 4. Insert the cross-tenant role assignment (tenantId = NULL)
  await db.insert(userRolesTable).values({
    userId: user.id,
    roleId: role.id,
    tenantId: null, // null = cross-tenant
  });

  console.log(`✓ platform_admin role granted to '${user.fullName}' (${user.email})`);
  console.log("  They can now access /platform-admin in the web app.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
