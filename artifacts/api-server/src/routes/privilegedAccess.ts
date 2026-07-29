/**
 * Privileged-Access Review API
 * Enforces the four-eyes principle: verifies that no single role can
 * simultaneously alter verified results + approve payments + erase audit records.
 * Exposes a review screen for admins.
 */
import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import { usersTable, userRolesTable, rolesTable } from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import { requireRoles } from "../middlewares/rbac";
import { tenantFilter, assertTenant } from '../lib/withTenant';

const router = Router();

function requireAuth(req: any, res: any, next: any) {
  const auth = getAuth(req);
  if (!auth?.userId) return res.status(401).json({ error: "Unauthorized" });
  req.clerkId = auth.userId;
  next();
}

// Mutually-exclusive privilege groups that must NOT be held by the same user
const CONFLICTING_PRIVILEGE_GROUPS = [
  {
    name: "Tally + Finance + Audit",
    description: "No user may simultaneously alter verified results AND approve payments AND erase audit records.",
    groups: [
      { label: "Tally Verifiers", roles: ["national-tally-verifier", "county-verification-officer"] },
      { label: "Payment Approvers", roles: ["finance-manager", "returning-officer"] },
      { label: "Audit Managers", roles: ["campaign-exec-director", "super-admin"] },
    ],
  },
];

// GET /api/privileged-access/review
router.get(
  "/review",
  requireAuth,
  requireRoles(["campaign-exec-director", "super-admin", "data-officer"]),
  async (req: any, res: any) => {
    try {
      const t = assertTenant(req);
      // Load all user→role assignments
      const assignments = await db
        .select({
          userId: usersTable.id,
          clerkId: usersTable.clerkId,
          fullName: usersTable.fullName,
          email: usersTable.email,
          roleSlug: rolesTable.slug,
          roleName: rolesTable.name,
        })
        .from(userRolesTable)
        .innerJoin(usersTable, eq(userRolesTable.userId, usersTable.id))
        .innerJoin(rolesTable, eq(userRolesTable.roleId, rolesTable.id))
        .where(tenantFilter(userRolesTable, t.id));

      // Group by user
      const byUser = new Map<string, {
        userId: string; fullName: string; email: string; roles: string[];
      }>();
      for (const a of assignments) {
        if (!byUser.has(a.userId)) {
          byUser.set(a.userId, { userId: a.userId, fullName: a.fullName ?? "", email: a.email ?? "", roles: [] });
        }
        byUser.get(a.userId)!.roles.push(a.roleSlug ?? "");
      }

      // Check conflicts
      const violations: Array<{
        userId: string; fullName: string; email: string;
        conflictRule: string; heldRoles: string[];
      }> = [];

      for (const user of byUser.values()) {
        for (const rule of CONFLICTING_PRIVILEGE_GROUPS) {
          // User must NOT hold roles from 2+ groups
          const groupsHeld = rule.groups.filter((g) =>
            g.roles.some((r) => user.roles.includes(r))
          );
          if (groupsHeld.length >= 2) {
            violations.push({
              userId: user.userId,
              fullName: user.fullName,
              email: user.email,
              conflictRule: rule.name,
              heldRoles: user.roles,
            });
          }
        }
      }

      res.json({
        users: Array.from(byUser.values()),
        violations,
        privilegeGroups: CONFLICTING_PRIVILEGE_GROUPS,
        checkedAt: new Date().toISOString(),
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

export default router;
