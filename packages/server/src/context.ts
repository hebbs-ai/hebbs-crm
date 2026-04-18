import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

export interface AgentEngineRef {
  wake(req: { tenantId: string; agentId: string; taskId?: string; reason: string }): Promise<unknown>;
}

export interface CrmContext {
  db: PostgresJsDatabase;
  emitEvent?: (type: string, tenantId: string, data: Record<string, unknown>) => void;
  agentEngine?: AgentEngineRef;
}

export function createCrmContext(
  db: unknown,
  emitEvent?: CrmContext["emitEvent"],
  agentEngine?: AgentEngineRef,
): CrmContext {
  return { db: db as PostgresJsDatabase, emitEvent, agentEngine };
}
