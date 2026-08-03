import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const db = drizzle(pool, { schema });

export * from "./schema";

// The role catalogue is plain data (no db import), so exporting it here is
// cycle-free. The API server's startup bootstrap needs it to guarantee every
// environment has the full set of roles, not just the ones a manual seed run
// happened to create.
export { ROLES } from "./seeds/roleCatalogue";
