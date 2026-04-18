import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

export interface AgentEngineRef {
  wake(req: { tenantId: string; agentId: string; taskId?: string; reason: string }): Promise<
    | { kind: "created"; wakeupRequestId: string }
    | { kind: "coalesced"; existingWakeupRequestId: string }
    | { kind: "agent_not_found" }
    | { kind: "agent_not_invokable"; agentStatus: string }
  >;
  enqueue(wakeupRequestId: string): Promise<string>;
}

export interface WorkflowEngineRef {
  execute(workflowId: string, trigger?: { type: string; data: Record<string, unknown> }): Promise<{ runId: string; status: string; error?: string; awaitingActionTaskId?: string }>;
  resume(runId: string, userInput?: Record<string, unknown>): Promise<{ runId: string; status: string; error?: string; awaitingActionTaskId?: string }>;
}

export interface CrmContext {
  db: PostgresJsDatabase;
  emitEvent?: (type: string, tenantId: string, data: Record<string, unknown>) => void;
  agentEngine?: AgentEngineRef;
  workflowEngine?: WorkflowEngineRef;
}

export function createCrmContext(
  db: unknown,
  emitEvent?: CrmContext["emitEvent"],
  agentEngine?: AgentEngineRef,
  workflowEngine?: WorkflowEngineRef,
): CrmContext {
  return { db: db as PostgresJsDatabase, emitEvent, agentEngine, workflowEngine };
}
