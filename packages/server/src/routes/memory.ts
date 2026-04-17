import { Hono } from "hono";
import { sql } from "drizzle-orm";
import type { CrmContext } from "../context.js";

/**
 * Memory routes — configure Hebbs + Knowledge Base file management.
 * Memory is opt-in: user enters Hebbs endpoint + API key in Settings.
 */
export function createMemoryRoutes(ctx: CrmContext) {
  const app = new Hono();

  // GET /config — get current memory configuration
  app.get("/config", async (c) => {
    const tenantId = c.req.header("X-Tenant-Id")!;
    const result = await ctx.db.execute(sql`
      SELECT key, value FROM tenant_settings
      WHERE tenant_id = ${tenantId} AND key LIKE 'hebbs_%'
    `);
    const rows = result as unknown as Array<{ key: string; value: string | null }>;
    const config: Record<string, string | null> = {};
    for (const r of rows) config[r.key] = r.value;

    return c.json({
      configured: !!(config.hebbs_endpoint && config.hebbs_api_key),
      endpoint: config.hebbs_endpoint ?? null,
      hasApiKey: !!config.hebbs_api_key,
    });
  });

  // POST /config — save Hebbs credentials (validates first)
  app.post("/config", async (c) => {
    const tenantId = c.req.header("X-Tenant-Id")!;
    const body = await c.req.json() as { endpoint: string; apiKey: string };

    if (!body.endpoint || !body.apiKey) {
      return c.json({ error: "endpoint and apiKey required" }, 400);
    }

    // Validate connection
    try {
      const url = body.endpoint.replace(/\/$/, "");
      const res = await fetch(`${url}/v1/system/health`, {
        headers: { Authorization: `Bearer ${body.apiKey}` },
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) {
        return c.json({ error: `Hebbs connection failed: HTTP ${res.status}` }, 400);
      }
    } catch (err) {
      return c.json({ error: `Cannot reach Hebbs at ${body.endpoint}: ${err instanceof Error ? err.message : String(err)}` }, 400);
    }

    // Store credentials
    for (const [key, value] of [["hebbs_endpoint", body.endpoint], ["hebbs_api_key", body.apiKey]]) {
      const existing = await ctx.db.execute(sql`
        SELECT id FROM tenant_settings WHERE tenant_id = ${tenantId} AND key = ${key} LIMIT 1
      `);
      const rows = existing as unknown as Array<{ id: string }>;
      if (rows[0]) {
        await ctx.db.execute(sql`
          UPDATE tenant_settings SET value = ${value}, updated_at = now() WHERE id = ${rows[0].id}
        `);
      } else {
        const { randomUUID } = await import("node:crypto");
        await ctx.db.execute(sql`
          INSERT INTO tenant_settings (id, tenant_id, key, value) VALUES (${randomUUID()}, ${tenantId}, ${key}, ${value})
        `);
      }
    }

    return c.json({ configured: true });
  });

  // DELETE /config — remove Hebbs credentials (disable memory)
  app.delete("/config", async (c) => {
    const tenantId = c.req.header("X-Tenant-Id")!;
    await ctx.db.execute(sql`
      DELETE FROM tenant_settings WHERE tenant_id = ${tenantId} AND key LIKE 'hebbs_%'
    `);
    return c.json({ configured: false });
  });

  // GET /files — list files, optionally filtered by entity
  // ?entityType=contact&entityId=uuid OR no params for org-level (Knowledge Base)
  app.get("/files", async (c) => {
    const tenantId = c.req.header("X-Tenant-Id")!;
    const entityType = c.req.query("entityType");
    const entityId = c.req.query("entityId");

    let result;
    if (entityType === "org") {
      result = await ctx.db.execute(sql`
        SELECT id, name, size, status, entity_type as "entityType", entity_id as "entityId", remote_path as "remotePath", created_at as "createdAt"
        FROM crm_knowledge_files
        WHERE tenant_id = ${tenantId} AND entity_type = 'org'
        ORDER BY created_at DESC
      `);
    } else if (entityType && entityId) {
      result = await ctx.db.execute(sql`
        SELECT id, name, size, status, entity_type as "entityType", entity_id as "entityId", remote_path as "remotePath", created_at as "createdAt"
        FROM crm_knowledge_files
        WHERE tenant_id = ${tenantId} AND entity_type = ${entityType} AND entity_id = ${entityId}
        ORDER BY created_at DESC
      `);
    } else {
      result = await ctx.db.execute(sql`
        SELECT id, name, size, status, entity_type as "entityType", entity_id as "entityId", remote_path as "remotePath", created_at as "createdAt"
        FROM crm_knowledge_files
        WHERE tenant_id = ${tenantId}
        ORDER BY created_at DESC
      `);
    }
    const files = result as unknown as Array<{ id: string; name: string; size: number; status: string; remotePath: string; createdAt: string }>;

    // For pending files, check Hebbs status and update
    const pendingFiles = files.filter((f) => f.status === "pending" || f.status === "indexing");
    if (pendingFiles.length > 0) {
      const configResult = await ctx.db.execute(sql`
        SELECT key, value FROM tenant_settings WHERE tenant_id = ${tenantId} AND key LIKE 'hebbs_%'
      `);
      const config: Record<string, string> = {};
      for (const r of configResult as unknown as Array<{ key: string; value: string }>) config[r.key] = r.value;

      if (config.hebbs_endpoint && config.hebbs_api_key) {
        try {
          const { HebbsRestClient } = await import("@hebbs/sdk");
          const hb = new HebbsRestClient(config.hebbs_endpoint.replace(/\/$/, ""), { apiKey: config.hebbs_api_key });
          for (const f of pendingFiles) {
            try {
              const status = await hb.fileStatus(f.remotePath);
              if (status.status === "indexed" && f.status !== "indexed") {
                await ctx.db.execute(sql`UPDATE crm_knowledge_files SET status = 'indexed' WHERE id = ${f.id}`);
                f.status = "indexed";
              } else if (status.status === "indexing" && f.status !== "indexing") {
                await ctx.db.execute(sql`UPDATE crm_knowledge_files SET status = 'indexing' WHERE id = ${f.id}`);
                f.status = "indexing";
              }
            } catch { /* skip individual file errors */ }
          }
        } catch { /* skip if Hebbs unreachable */ }
      }
    }

    return c.json({ files: files.map(({ remotePath: _, ...f }) => f) });
  });

  // GET /files/:id/status — get real-time indexing status from Hebbs
  app.get("/files/:id/status", async (c) => {
    const tenantId = c.req.header("X-Tenant-Id")!;
    const fileId = c.req.param("id");

    const fileResult = await ctx.db.execute(sql`
      SELECT remote_path FROM crm_knowledge_files WHERE id = ${fileId} AND tenant_id = ${tenantId} LIMIT 1
    `);
    const remotePath = (fileResult as unknown as Array<{ remote_path: string }>)[0]?.remote_path;
    if (!remotePath) return c.json({ error: "File not found" }, 404);

    const configResult = await ctx.db.execute(sql`
      SELECT key, value FROM tenant_settings WHERE tenant_id = ${tenantId} AND key LIKE 'hebbs_%'
    `);
    const config: Record<string, string> = {};
    for (const r of configResult as unknown as Array<{ key: string; value: string }>) config[r.key] = r.value;

    if (!config.hebbs_endpoint || !config.hebbs_api_key) {
      return c.json({ status: "not_configured" });
    }

    try {
      const { HebbsRestClient } = await import("@hebbs/sdk");
      const hb = new HebbsRestClient(config.hebbs_endpoint.replace(/\/$/, ""), { apiKey: config.hebbs_api_key });
      const status = await hb.fileStatus(remotePath);

      // Update local status if changed
      if (status.status === "indexed") {
        await ctx.db.execute(sql`
          UPDATE crm_knowledge_files SET status = 'indexed' WHERE id = ${fileId}
        `);
      }

      return c.json(status);
    } catch (err) {
      return c.json({ status: "error", error: err instanceof Error ? err.message : String(err) });
    }
  });

  // POST /files — upload file to knowledge base
  app.post("/files", async (c) => {
    const tenantId = c.req.header("X-Tenant-Id")!;

    // Check memory is configured
    const configResult = await ctx.db.execute(sql`
      SELECT value FROM tenant_settings WHERE tenant_id = ${tenantId} AND key = 'hebbs_endpoint' LIMIT 1
    `);
    const endpoint = (configResult as unknown as Array<{ value: string }>)[0]?.value;
    if (!endpoint) {
      return c.json({ error: "Memory not configured. Go to Settings → Memory to configure." }, 400);
    }

    const apiKeyResult = await ctx.db.execute(sql`
      SELECT value FROM tenant_settings WHERE tenant_id = ${tenantId} AND key = 'hebbs_api_key' LIMIT 1
    `);
    const apiKey = (apiKeyResult as unknown as Array<{ value: string }>)[0]?.value;

    // Parse multipart form
    const formData = await c.req.formData();
    const file = formData.get("file") as File | null;
    if (!file) return c.json({ error: "No file provided" }, 400);

    const entityType = formData.get("entityType") as string | null;
    const entityId = formData.get("entityId") as string | null;

    const content = new Uint8Array(await file.arrayBuffer());

    // Build Hebbs path: {tenantId}/entities/{entityScope}/{filename}
    // entityScope: "org" for Knowledge Base, "contact-{id}" for contacts, etc.
    let entityScope = "org";
    if (entityType && entityId) {
      entityScope = `${entityType}-${entityId}`;
    }
    const remotePath = `${tenantId}/entities/${entityScope}/${file.name}`;

    // Upload to Hebbs
    try {
      const { HebbsRestClient } = await import("@hebbs/sdk");
      const hb = new HebbsRestClient(endpoint.replace(/\/$/, ""), { apiKey: apiKey ?? "" });
      await hb.upload(remotePath, content);
    } catch (err) {
      return c.json({ error: `Failed to index file: ${err instanceof Error ? err.message : String(err)}` }, 500);
    }

    // Store file record
    const { randomUUID } = await import("node:crypto");
    const fileId = randomUUID();
    await ctx.db.execute(sql`
      INSERT INTO crm_knowledge_files (id, tenant_id, name, size, status, remote_path, entity_type, entity_id, created_at)
      VALUES (${fileId}, ${tenantId}, ${file.name}, ${content.length}, 'pending', ${remotePath},
        ${entityType ?? "org"}, ${entityId ?? null}, now())
    `);

    return c.json({ id: fileId, name: file.name, status: "pending" }, 201);
  });

  // DELETE /files/:id — delete file from knowledge base
  app.delete("/files/:id", async (c) => {
    const tenantId = c.req.header("X-Tenant-Id")!;
    const fileId = c.req.param("id");

    // Get file record
    const fileResult = await ctx.db.execute(sql`
      SELECT remote_path FROM crm_knowledge_files WHERE id = ${fileId} AND tenant_id = ${tenantId} LIMIT 1
    `);
    const remotePath = (fileResult as unknown as Array<{ remote_path: string }>)[0]?.remote_path;
    if (!remotePath) return c.json({ error: "File not found" }, 404);

    // Get Hebbs credentials
    const configResult = await ctx.db.execute(sql`
      SELECT key, value FROM tenant_settings WHERE tenant_id = ${tenantId} AND key LIKE 'hebbs_%'
    `);
    const config: Record<string, string> = {};
    for (const r of configResult as unknown as Array<{ key: string; value: string }>) config[r.key] = r.value;

    // Delete from Hebbs
    if (config.hebbs_endpoint && config.hebbs_api_key) {
      try {
        const { HebbsRestClient } = await import("@hebbs/sdk");
        const hb = new HebbsRestClient(config.hebbs_endpoint.replace(/\/$/, ""), { apiKey: config.hebbs_api_key });
        await hb.deleteFile(remotePath);
      } catch {
        // Non-fatal — delete file record even if Hebbs fails
      }
    }

    // Delete file record
    await ctx.db.execute(sql`DELETE FROM crm_knowledge_files WHERE id = ${fileId}`);
    return c.json({ ok: true });
  });

  return app;
}

export function agentDocs(url: string): string {
  const tid = "$BORINGOS_TENANT_ID";
  return `**Knowledge Base Files** — documents indexed into Hebbs memory, scoped to the org or to a specific entity. Use \`entityType=org\` for org-wide docs, or \`entityType=contact|company|deal\` + \`entityId\` for entity-scoped docs.

\`\`\`
curl -s "${url}/api/crm/memory/files?entityType=org" -H "X-Tenant-Id: ${tid}"
curl -s "${url}/api/crm/memory/files?entityType=contact&entityId=ID" -H "X-Tenant-Id: ${tid}"
curl -s -X DELETE ${url}/api/crm/memory/files/ID -H "X-Tenant-Id: ${tid}"
\`\`\`

Uploads are multipart/form-data and should generally be driven by users in the UI, not agents.`;
}
