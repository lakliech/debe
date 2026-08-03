import { db } from "../index";
import { rolesTable } from "../schema";
import { sql } from "drizzle-orm";
import { ROLES } from "./roleCatalogue";

export { ROLES };


import { brandingTable } from "../schema";

export async function seedBranding() {
  const existing = await db.select().from(brandingTable).limit(1);
  const data = {
    campaignName: "Linda Mwananchi",
    candidateName: "Linda Mwananchi Campaign",
    primaryColor: "#1D9BF0",
    secondaryColor: "#000000",
    accentColor: "#000000",
    tagline: "It's Time. Be Part of the Change.",
    electionYear: 2027,
    websiteUrl: "https://lindamwananchi.com",
    socialTwitter: "@LindaMwananchi",
  };
  if (existing[0]) {
    await db.update(brandingTable).set(data);
    console.log("✓ Branding updated");
  } else {
    await db.insert(brandingTable).values(data);
    console.log("✓ Branding seeded");
  }
}

export async function seedRoles() {
  console.log("Seeding roles...");
  for (const role of ROLES) {
    await db
      .insert(rolesTable)
      .values(role)
      .onConflictDoUpdate({
        target: rolesTable.slug,
        set: { name: role.name, description: role.description, level: role.level, color: role.color },
      });
  }
  console.log(`✓ ${ROLES.length} roles seeded`);
}
