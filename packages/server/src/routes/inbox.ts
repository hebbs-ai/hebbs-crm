import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { GmailClient } from "@boringos/connector-google";
import type { CrmContext } from "../context.js";

export function createInboxRoutes(ctx: CrmContext) {
  const app = new Hono();

  /**
   * POST /inbox/backfill-bodies
   *
   * Fetches full email bodies from Gmail for inbox items that only have snippets.
   * Targets: all "needs attention" items (score >= 50) + top 3 archived.
   */
  app.post("/backfill-bodies", async (c) => {
    const tenantId = c.req.header("X-Tenant-Id")!;
    const db = ctx.db;

    // 1. Get Google connector credentials for this tenant
    const connectorRows = await db.execute(sql`
      SELECT id, credentials FROM connectors
      WHERE tenant_id = ${tenantId} AND kind = 'google'
      LIMIT 1
    `) as unknown as Array<{ id: string; credentials: Record<string, string> }>;

    const creds = connectorRows[0]?.credentials;
    if (!creds?.accessToken) {
      return c.json({ error: "Google connector not configured" }, 400);
    }

    // Refresh token if needed (proactively refresh to avoid 401s)
    let accessToken = creds.accessToken;
    if (creds.refreshToken) {
      const clientId = process.env.GOOGLE_CLIENT_ID;
      const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
      if (clientId && clientSecret) {
        try {
          const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              grant_type: "refresh_token",
              refresh_token: creds.refreshToken,
              client_id: clientId,
              client_secret: clientSecret,
            }).toString(),
          });
          if (tokenRes.ok) {
            const tokenData = await tokenRes.json() as { access_token: string };
            accessToken = tokenData.access_token;
            // Persist refreshed token
            await db.execute(sql`
              UPDATE connectors SET credentials = credentials || ${JSON.stringify({ accessToken })}::jsonb, updated_at = now()
              WHERE id = ${connectorRows[0].id}
            `);
          }
        } catch { /* fall through with existing token */ }
      }
    }

    const gmail = new GmailClient(accessToken);

    // 2. Find items to backfill:
    //    - "needs attention" = gmail source, not archived, agent score >= 50 or not yet analyzed
    //    - top 3 archived gmail items (most recent)
    const needsAttention = await db.execute(sql`
      SELECT id, source_id FROM inbox_items
      WHERE tenant_id = ${tenantId}
        AND source = 'gmail'
        AND status IN ('unread', 'read')
        AND source_id IS NOT NULL
        AND ((metadata->'agentAnalysis'->>'score')::int >= 50
          OR (metadata->>'agentAnalysis') IS NULL)
    `) as unknown as Array<{ id: string; source_id: string }>;

    const topArchived = await db.execute(sql`
      SELECT id, source_id FROM inbox_items
      WHERE tenant_id = ${tenantId}
        AND source = 'gmail'
        AND status = 'archived'
        AND source_id IS NOT NULL
      ORDER BY created_at DESC
      LIMIT 3
    `) as unknown as Array<{ id: string; source_id: string }>;

    const candidates = [...needsAttention, ...topArchived];

    // 3. Fetch full body from Gmail and update each item
    let updated = 0;
    const errors: string[] = [];

    for (const item of candidates) {
      try {
        const result = await gmail.executeAction("read_email", { messageId: item.source_id });
        if (!result.success || !result.data) {
          errors.push(`${item.source_id}: ${result.error ?? "no data"}`);
          continue;
        }

        const payload = (result.data as any).payload;
        const body = extractBodyFromPayload(payload);
        if (!body) continue;

        await db.execute(sql`
          UPDATE inbox_items SET body = ${body}, updated_at = now()
          WHERE id = ${item.id}
        `);
        updated++;
      } catch (err) {
        errors.push(`${item.source_id}: ${(err as Error).message}`);
      }
    }

    return c.json({ updated, total: candidates.length, errors: errors.length > 0 ? errors : undefined });
  });

  return app;
}

/** Decode base64url Gmail body data to UTF-8 string. */
function decodeBase64Url(data: string): string {
  return Buffer.from(data, "base64url").toString("utf-8");
}

/** Extract plain-text or HTML body from a Gmail message payload. */
function extractBodyFromPayload(
  payload?: { body?: { data?: string }; parts?: Array<{ mimeType: string; body?: { data?: string }; parts?: Array<{ mimeType: string; body?: { data?: string } }> }> },
): string | null {
  if (!payload) return null;

  if (payload.body?.data) return decodeBase64Url(payload.body.data);
  if (!payload.parts) return null;

  let plain: string | null = null;
  let html: string | null = null;

  for (const part of payload.parts) {
    if (part.mimeType === "text/plain" && part.body?.data) plain = decodeBase64Url(part.body.data);
    else if (part.mimeType === "text/html" && part.body?.data) html = decodeBase64Url(part.body.data);
    if (part.parts) {
      for (const sub of part.parts) {
        if (sub.mimeType === "text/plain" && sub.body?.data && !plain) plain = decodeBase64Url(sub.body.data);
        else if (sub.mimeType === "text/html" && sub.body?.data && !html) html = decodeBase64Url(sub.body.data);
      }
    }
  }

  return plain ?? html ?? null;
}
