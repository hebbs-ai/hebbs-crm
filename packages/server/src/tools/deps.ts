// Shared dependencies threaded into every tool factory in
// packages/server/src/tools/*.ts. Built once in module.ts from the
// `ModuleFactoryDeps` the framework injects, then handed to each
// tool factory as a closure capture.

import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

/**
 * Lazy event bus reference — populated by the host after the
 * factory is called, so we read it at call time, not capture time.
 * Mirrors the pattern in framework/triage v2 modules.
 */
export interface CrmEventBus {
  emit(event: {
    connectorKind: string;
    type: string;
    tenantId: string;
    data: Record<string, unknown>;
    timestamp: Date;
  }): Promise<void> | void;
}

export interface CrmDeps {
  db: PostgresJsDatabase;
  /** Read at call time — undefined-safe. */
  getEventBus: () => CrmEventBus | null;
}

export function emitCrm(
  deps: CrmDeps,
  type: string,
  tenantId: string,
  data: Record<string, unknown>,
): void {
  const bus = deps.getEventBus();
  if (!bus) return;
  // Fire-and-forget — tools that emit events shouldn't block on
  // subscriber failures.
  void Promise.resolve(
    bus.emit({
      connectorKind: "crm",
      type,
      tenantId,
      data,
      timestamp: new Date(),
    }),
  ).catch(() => {});
}
