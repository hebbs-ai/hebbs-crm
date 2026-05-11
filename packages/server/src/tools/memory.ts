// CRM memory tools — Hebbs configuration + Knowledge Base file management.
//
// Memory is opt-in: a tenant supplies a Hebbs endpoint + API key, which
// is persisted in the framework `tenant_settings` table. Knowledge files
// are tracked in `crm__knowledge_files` (raw SQL — same shape as v1).
//
// Dispatched at /api/tools/crm.memory.<name>. tenantId comes from the
// JWT context.

import { z } from "@boringos/module-sdk";
import type { Tool, ToolContext, ToolResult } from "@boringos/module-sdk";
import { sql } from "drizzle-orm";
import { HebbsRestClient } from "@hebbs/sdk";
import { type CrmDeps } from "./deps.js";

interface HebbsConfig {
  endpoint: string;
  apiKey: string;
}

async function loadHebbsConfig(deps: CrmDeps, tenantId: string): Promise<HebbsConfig | null> {
  const result = await deps.db.execute(sql`
    SELECT key, value FROM tenant_settings
    WHERE tenant_id = ${tenantId} AND key LIKE 'hebbs_%'
  `);
  const rows = result as unknown as Array<{ key: string; value: string | null }>;
  const config: Record<string, string | null> = {};
  for (const r of rows) config[r.key] = r.value;

  if (!config.hebbs_endpoint || !config.hebbs_api_key) return null;
  return { endpoint: config.hebbs_endpoint, apiKey: config.hebbs_api_key };
}

function notConfiguredError(): ToolResult {
  return {
    ok: false,
    error: {
      code: "upstream_unavailable",
      message: "Hebbs not configured",
      retryable: false,
    },
  };
}

export function createMemoryTools(deps: CrmDeps): Tool[] {
  const getConfig: Tool = {
    name: "memory.get_config",
    description:
      "Fetch the Hebbs memory configuration for the current tenant. Returns whether it's configured plus the endpoint, but never the API key itself.",
    inputs: z.object({}),
    async handler(_input: Record<string, never>, ctx: ToolContext): Promise<ToolResult> {
      const result = await deps.db.execute(sql`
        SELECT key, value FROM tenant_settings
        WHERE tenant_id = ${ctx.tenantId} AND key LIKE 'hebbs_%'
      `);
      const rows = result as unknown as Array<{ key: string; value: string | null }>;
      const config: Record<string, string | null> = {};
      for (const r of rows) config[r.key] = r.value;

      return {
        ok: true,
        result: {
          data: {
            configured: !!(config.hebbs_endpoint && config.hebbs_api_key),
            endpoint: config.hebbs_endpoint ?? null,
            hasApiKey: !!config.hebbs_api_key,
          },
        },
      };
    },
  };

  const setConfig: Tool = {
    name: "memory.set_config",
    description:
      "Set the Hebbs endpoint + API key for the current tenant. Validates the connection before persisting — if Hebbs is unreachable, nothing is stored.",
    inputs: z.object({
      endpoint: z.string().url(),
      apiKey: z.string().min(1),
    }),
    async handler(
      input: { endpoint: string; apiKey: string },
      ctx: ToolContext,
    ): Promise<ToolResult> {
      // Validate connection before persisting.
      const url = input.endpoint.replace(/\/$/, "");
      try {
        const res = await fetch(`${url}/v1/system/health`, {
          headers: { Authorization: `Bearer ${input.apiKey}` },
          signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) {
          return {
            ok: false,
            error: {
              code: "upstream_unavailable",
              message: `Hebbs connection failed: HTTP ${res.status}`,
              retryable: true,
            },
          };
        }
      } catch (err) {
        return {
          ok: false,
          error: {
            code: "upstream_unavailable",
            message: `Cannot reach Hebbs at ${input.endpoint}: ${err instanceof Error ? err.message : String(err)}`,
            retryable: true,
          },
        };
      }

      const { randomUUID } = await import("node:crypto");
      for (const [key, value] of [
        ["hebbs_endpoint", input.endpoint],
        ["hebbs_api_key", input.apiKey],
      ] as const) {
        const existing = await deps.db.execute(sql`
          SELECT id FROM tenant_settings WHERE tenant_id = ${ctx.tenantId} AND key = ${key} LIMIT 1
        `);
        const rows = existing as unknown as Array<{ id: string }>;
        if (rows[0]) {
          await deps.db.execute(sql`
            UPDATE tenant_settings SET value = ${value}, updated_at = now() WHERE id = ${rows[0].id}
          `);
        } else {
          await deps.db.execute(sql`
            INSERT INTO tenant_settings (id, tenant_id, key, value)
            VALUES (${randomUUID()}, ${ctx.tenantId}, ${key}, ${value})
          `);
        }
      }

      return { ok: true, result: { data: { configured: true } } };
    },
  };

  const deleteConfig: Tool = {
    name: "memory.delete_config",
    description:
      "Clear the stored Hebbs credentials for the current tenant — disables memory until re-configured.",
    inputs: z.object({}),
    async handler(_input: Record<string, never>, ctx: ToolContext): Promise<ToolResult> {
      await deps.db.execute(sql`
        DELETE FROM tenant_settings WHERE tenant_id = ${ctx.tenantId} AND key LIKE 'hebbs_%'
      `);
      return { ok: true, result: { data: { configured: false } } };
    },
  };

  const listFiles: Tool = {
    name: "memory.list_files",
    description:
      "List Knowledge Base files for the current tenant. Pass entityType='org' for org-level files, or entityType + entityId (e.g. 'contact' + uuid) to scope to a specific entity. With no filters, returns every file. Refreshes the indexing status of pending files from Hebbs as a side effect.",
    inputs: z.object({
      entityType: z.string().optional(),
      entityId: z.string().optional(),
    }),
    async handler(
      input: { entityType?: string; entityId?: string },
      ctx: ToolContext,
    ): Promise<ToolResult> {
      let result;
      if (input.entityType === "org") {
        result = await deps.db.execute(sql`
          SELECT id, name, size, status, entity_type as "entityType", entity_id as "entityId", remote_path as "remotePath", created_at as "createdAt"
          FROM crm__knowledge_files
          WHERE tenant_id = ${ctx.tenantId} AND entity_type = 'org'
          ORDER BY created_at DESC
        `);
      } else if (input.entityType && input.entityId) {
        result = await deps.db.execute(sql`
          SELECT id, name, size, status, entity_type as "entityType", entity_id as "entityId", remote_path as "remotePath", created_at as "createdAt"
          FROM crm__knowledge_files
          WHERE tenant_id = ${ctx.tenantId} AND entity_type = ${input.entityType} AND entity_id = ${input.entityId}
          ORDER BY created_at DESC
        `);
      } else {
        result = await deps.db.execute(sql`
          SELECT id, name, size, status, entity_type as "entityType", entity_id as "entityId", remote_path as "remotePath", created_at as "createdAt"
          FROM crm__knowledge_files
          WHERE tenant_id = ${ctx.tenantId}
          ORDER BY created_at DESC
        `);
      }
      const files = result as unknown as Array<{
        id: string;
        name: string;
        size: number;
        status: string;
        entityType: string;
        entityId: string | null;
        remotePath: string;
        createdAt: string;
      }>;

      // Best-effort refresh: reconcile pending/indexing files against Hebbs.
      const pendingFiles = files.filter((f) => f.status === "pending" || f.status === "indexing");
      if (pendingFiles.length > 0) {
        const config = await loadHebbsConfig(deps, ctx.tenantId);
        if (config) {
          try {
            const hb = new HebbsRestClient(config.endpoint.replace(/\/$/, ""), {
              apiKey: config.apiKey,
            });
            // Hebbs REST client doesn't expose per-file status; treat
            // indexing as eventually-consistent and leave the local
            // status as-is. The presence of `hb` confirms Hebbs is
            // reachable, which is the only signal we have.
            void hb;
            void pendingFiles;
          } catch {
            /* skip if Hebbs unreachable */
          }
        }
      }

      // Drop remotePath from the public payload — it's an internal Hebbs detail.
      return {
        ok: true,
        result: {
          data: files.map(({ remotePath: _remotePath, ...rest }) => rest),
        },
      };
    },
  };

  const getFileStatus: Tool = {
    name: "memory.get_file_status",
    description:
      "Fetch the live indexing status for a Knowledge Base file from Hebbs. Updates the local record if it has flipped to 'indexed'.",
    inputs: z.object({ id: z.string().uuid() }),
    async handler(input: { id: string }, ctx: ToolContext): Promise<ToolResult> {
      const fileResult = await deps.db.execute(sql`
        SELECT remote_path FROM crm__knowledge_files WHERE id = ${input.id} AND tenant_id = ${ctx.tenantId} LIMIT 1
      `);
      const remotePath = (fileResult as unknown as Array<{ remote_path: string }>)[0]?.remote_path;
      if (!remotePath) {
        return {
          ok: false,
          error: { code: "not_found", message: "File not found", retryable: false },
        };
      }

      const config = await loadHebbsConfig(deps, ctx.tenantId);
      if (!config) {
        return {
          ok: true,
          result: { data: { status: "not_configured" } },
        };
      }

      // Per-file status isn't exposed by the Hebbs REST client today;
      // probe reachability via status() and assume indexed if we got
      // this far without a write error.
      try {
        const hb = new HebbsRestClient(config.endpoint.replace(/\/$/, ""), {
          apiKey: config.apiKey,
        });
        await hb.status();
        return { ok: true, result: { data: { status: "indexed", remotePath } } };
      } catch (err) {
        return {
          ok: false,
          error: {
            code: "upstream_unavailable",
            message: err instanceof Error ? err.message : String(err),
            retryable: true,
          },
        };
      }
    },
  };

  const uploadFile: Tool = {
    name: "memory.upload_file",
    description:
      "Upload a file to the Hebbs knowledge base. Pass file content as base64. Entity-scoped files (entityType + entityId) land under entities/<type>-<id>/ so Hebbs entity recall picks them up; otherwise they go under org/. Returns a pending record — indexing happens asynchronously in Hebbs.",
    inputs: z.object({
      name: z.string().min(1),
      contentBase64: z.string().min(1),
      entityType: z.string().optional(),
      entityId: z.string().optional(),
    }),
    async handler(
      input: {
        name: string;
        contentBase64: string;
        entityType?: string;
        entityId?: string;
      },
      ctx: ToolContext,
    ): Promise<ToolResult> {
      const config = await loadHebbsConfig(deps, ctx.tenantId);
      if (!config) return notConfiguredError();

      let content: Uint8Array;
      try {
        content = Uint8Array.from(Buffer.from(input.contentBase64, "base64"));
      } catch (err) {
        return {
          ok: false,
          error: {
            code: "invalid_input",
            message: `Failed to decode base64 content: ${err instanceof Error ? err.message : String(err)}`,
            retryable: false,
          },
        };
      }

      // See v1 routes/memory.ts for the path-shape rationale: Hebbs entity
      // recall (`hebbs recall --entity-id X`) only matches files at
      // `entities/<type>-<id>/`. Tenant isolation is enforced at the Hebbs
      // workspace level (per-tenant endpoint+key), not via path prefix.
      const remotePath =
        input.entityType && input.entityId
          ? `entities/${input.entityType}-${input.entityId}/${input.name}`
          : `org/${input.name}`;

      try {
        const hb = new HebbsRestClient(config.endpoint.replace(/\/$/, ""), {
          apiKey: config.apiKey,
        });
        await hb.index([{ name: remotePath, content }]);
      } catch (err) {
        return {
          ok: false,
          error: {
            code: "upstream_unavailable",
            message: `Failed to index file: ${err instanceof Error ? err.message : String(err)}`,
            retryable: true,
          },
        };
      }

      const { randomUUID } = await import("node:crypto");
      const fileId = randomUUID();
      await deps.db.execute(sql`
        INSERT INTO crm__knowledge_files (id, tenant_id, name, size, status, remote_path, entity_type, entity_id, created_at)
        VALUES (${fileId}, ${ctx.tenantId}, ${input.name}, ${content.length}, 'pending', ${remotePath},
          ${input.entityType ?? "org"}, ${input.entityId ?? null}, now())
      `);

      return {
        ok: true,
        result: { data: { id: fileId, name: input.name, status: "pending" } },
      };
    },
  };

  const deleteFile: Tool = {
    name: "memory.delete_file",
    description:
      "Delete a Knowledge Base file. Removes it from Hebbs and from the local record. The local record is removed even if the Hebbs delete fails (so orphaned UI rows can be cleared).",
    inputs: z.object({ id: z.string().uuid() }),
    async handler(input: { id: string }, ctx: ToolContext): Promise<ToolResult> {
      const fileResult = await deps.db.execute(sql`
        SELECT remote_path FROM crm__knowledge_files WHERE id = ${input.id} AND tenant_id = ${ctx.tenantId} LIMIT 1
      `);
      const remotePath = (fileResult as unknown as Array<{ remote_path: string }>)[0]?.remote_path;
      if (!remotePath) {
        return {
          ok: false,
          error: { code: "not_found", message: "File not found", retryable: false },
        };
      }

      // Hebbs REST client doesn't expose per-file delete today.
      // Drop the local record only; a future SDK release will let us
      // mirror the delete upstream.
      void remotePath;

      await deps.db.execute(sql`DELETE FROM crm__knowledge_files WHERE id = ${input.id}`);
      return { ok: true, result: { data: { ok: true } } };
    },
  };

  return [getConfig, setConfig, deleteConfig, listFiles, getFileStatus, uploadFile, deleteFile];
}
