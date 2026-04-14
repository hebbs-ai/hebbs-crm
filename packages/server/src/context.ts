import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

export interface CrmContext {
  db: PostgresJsDatabase;
  emitEvent?: (type: string, tenantId: string, data: Record<string, unknown>) => void;
}

export function createCrmContext(db: unknown, emitEvent?: CrmContext["emitEvent"]): CrmContext {
  return { db: db as PostgresJsDatabase, emitEvent };
}
