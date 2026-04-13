import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

export interface CrmContext {
  db: PostgresJsDatabase;
}

export function createCrmContext(db: unknown): CrmContext {
  return { db: db as PostgresJsDatabase };
}
