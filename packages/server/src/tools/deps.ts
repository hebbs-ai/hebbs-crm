// Shared dependencies threaded into every tool factory in
// packages/server/src/tools/*.ts. Built once in module.ts from the
// `ModuleFactoryDeps` the framework injects, then handed to each
// tool factory as a closure capture.

import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { ConnectorTokenHandle } from "@boringos/module-sdk";

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

/**
 * Connector-token accessor injected by the host via `ModuleFactoryDeps`.
 * The returned handle's `getToken()` refreshes the underlying access
 * token transparently when within 60s of expiry. Tenant is resolved
 * from the ambient `AsyncLocalStorage` tool-call context, so it does
 * not appear in this signature.
 *
 * Returns `null` if no account is connected or bound, OR if the host
 * did not inject `getConnectorToken` at all (older host, test harness
 * without AuthManager).
 */
export type GetConnectorToken = (
  provider: string,
  callerModuleId: string,
  opts?: { accountId?: string },
) => Promise<ConnectorTokenHandle | null>;

export interface CrmDeps {
  db: PostgresJsDatabase;
  /** Read at call time — undefined-safe. */
  getEventBus: () => CrmEventBus | null;
  /**
   * Always present at the type level; returns `null` if the host
   * did not inject the accessor or if the tenant has no connected
   * account for the requested provider. Replaces the pre-MDK
   * pattern of CRM reading the legacy `connectors` table directly.
   */
  getConnectorToken: GetConnectorToken;
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
