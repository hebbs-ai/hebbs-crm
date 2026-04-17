import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { GmailClient } from "@boringos/connector-google";
import type { CrmContext } from "../context.js";

/**
 * Get a GmailClient with a fresh access token for the given tenant.
 * Refreshes the token proactively and persists the new token.
 */
async function getGmailClient(
  db: CrmContext["db"],
  tenantId: string,
): Promise<{ gmail: GmailClient; error?: string } | { gmail?: undefined; error: string }> {
  const connectorRows = await db.execute(sql`
    SELECT id, credentials FROM connectors
    WHERE tenant_id = ${tenantId} AND kind = 'google'
    LIMIT 1
  `) as unknown as Array<{ id: string; credentials: Record<string, string> }>;

  const creds = connectorRows[0]?.credentials;
  if (!creds?.accessToken) {
    return { error: "Google connector not configured" };
  }

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
          await db.execute(sql`
            UPDATE connectors SET credentials = credentials || ${JSON.stringify({ accessToken })}::jsonb, updated_at = now()
            WHERE id = ${connectorRows[0].id}
          `);
        }
      } catch { /* fall through with existing token */ }
    }
  }

  return { gmail: new GmailClient(accessToken) };
}

export function createInboxRoutes(ctx: CrmContext) {
  const app = new Hono();

  /**
   * GET /inbox
   *
   * List inbox items for the tenant. Defaults to unread/unresolved items
   * (status != archived) so agents can find threads needing attention.
   * Query params: status=unread|archived|all (default unread), source=gmail|...,
   * limit (default 25), offset.
   */
  app.get("/", async (c) => {
    const tenantId = c.req.header("X-Tenant-Id")!;
    const { status = "unread", source, limit = "25", offset = "0" } = c.req.query();

    const filters = [sql`tenant_id = ${tenantId}`];
    if (status === "unread") filters.push(sql`status != 'archived'`);
    else if (status !== "all") filters.push(sql`status = ${status}`);
    if (source) filters.push(sql`source = ${source}`);

    const whereClause = filters.reduce((acc, f, i) => i === 0 ? f : sql`${acc} AND ${f}`);

    const rows = await ctx.db.execute(sql`
      SELECT id, source, subject, "from", status, created_at as "createdAt", archived_at as "archivedAt"
      FROM inbox_items
      WHERE ${whereClause}
      ORDER BY created_at DESC
      LIMIT ${Number(limit)} OFFSET ${Number(offset)}
    `) as unknown as Array<Record<string, unknown>>;

    return c.json({ data: rows, limit: Number(limit), offset: Number(offset) });
  });

  /**
   * GET /inbox/:id/thread
   *
   * Fetches full email thread from Gmail. Caches in metadata.threadMessages.
   * Returns the thread messages array.
   */
  app.get("/:id/thread", async (c) => {
    const tenantId = c.req.header("X-Tenant-Id")!;
    const itemId = c.req.param("id");
    const db = ctx.db;

    // Load the inbox item
    const rows = await db.execute(sql`
      SELECT id, source, source_id, metadata FROM inbox_items
      WHERE id = ${itemId} AND tenant_id = ${tenantId}
      LIMIT 1
    `) as unknown as Array<{ id: string; source: string; source_id: string | null; metadata: Record<string, unknown> | null }>;

    const item = rows[0];
    if (!item) return c.json({ error: "Item not found" }, 404);
    if (item.source !== "gmail") return c.json({ error: "Thread view only available for Gmail" }, 400);

    // Return cached thread if available
    const meta = item.metadata ?? {};
    if (meta.threadMessages) {
      return c.json({ threadMessages: meta.threadMessages });
    }

    // Get threadId from metadata, or resolve it from the message
    let threadId = (meta.threadId as string) ?? null;

    // Fetch thread from Gmail
    const clientResult = await getGmailClient(db, tenantId);
    if (!clientResult.gmail) return c.json({ error: clientResult.error }, 400);

    if (!threadId && item.source_id) {
      const msgResult = await clientResult.gmail.executeAction("read_email", { messageId: item.source_id });
      if (msgResult.success && msgResult.data) {
        threadId = (msgResult.data as any).threadId ?? null;
        if (threadId) {
          await db.execute(sql`
            UPDATE inbox_items
            SET metadata = COALESCE(metadata, '{}'::jsonb) || ${JSON.stringify({ threadId })}::jsonb
            WHERE id = ${itemId}
          `);
        }
      }
    }

    if (!threadId) return c.json({ error: "No thread ID available" }, 400);

    const result = await clientResult.gmail.executeAction("get_thread", { threadId });
    if (!result.success || !result.data) {
      return c.json({ error: result.error ?? "Failed to fetch thread" }, 502);
    }

    const threadMessages = (result.data as any).messages;

    // Cache thread in metadata and update body with latest message's plain text
    const latestMsg = threadMessages[threadMessages.length - 1];
    const bodyPlain = latestMsg?.bodyPlain ?? null;
    const bodyHtml = latestMsg?.bodyHtml ?? null;

    await db.execute(sql`
      UPDATE inbox_items
      SET metadata = COALESCE(metadata, '{}'::jsonb)
        || ${JSON.stringify({ threadMessages, bodyHtml })}::jsonb,
        body = COALESCE(${bodyPlain}, body),
        updated_at = now()
      WHERE id = ${itemId}
    `);

    return c.json({ threadMessages });
  });

  /**
   * POST /inbox/:id/reply
   *
   * Sends a reply to an email thread via Gmail.
   */
  app.post("/:id/reply", async (c) => {
    const tenantId = c.req.header("X-Tenant-Id")!;
    const itemId = c.req.param("id");
    const db = ctx.db;
    const { body: replyBody } = await c.req.json<{ body: string }>();

    if (!replyBody?.trim()) return c.json({ error: "Reply body is required" }, 400);

    // Load inbox item
    const rows = await db.execute(sql`
      SELECT id, source, source_id, subject, "from", metadata FROM inbox_items
      WHERE id = ${itemId} AND tenant_id = ${tenantId}
      LIMIT 1
    `) as unknown as Array<{ id: string; source: string; source_id: string; subject: string; from: string; metadata: Record<string, unknown> | null }>;

    const item = rows[0];
    if (!item) return c.json({ error: "Item not found" }, 404);
    if (item.source !== "gmail") return c.json({ error: "Reply only available for Gmail" }, 400);

    const clientResult = await getGmailClient(db, tenantId);
    if (!clientResult.gmail) return c.json({ error: clientResult.error }, 400);

    // Extract sender email for the To field
    const toEmail = item.from.match(/<([^>]+)>/)?.[1] ?? item.from;
    const threadId = (item.metadata?.threadId as string) ?? null;

    const result = await clientResult.gmail.executeAction("reply_email", {
      messageId: item.source_id,
      threadId: threadId ?? "",
      to: toEmail,
      subject: item.subject ?? "",
      body: replyBody,
    });

    if (!result.success) return c.json({ error: result.error }, 502);

    return c.json({ ok: true, messageId: result.data?.id });
  });

  /**
   * POST /inbox/:id/archive-gmail
   *
   * Archives the email in Gmail (removes INBOX label) and also dismisses it in the CRM.
   */
  app.post("/:id/archive-gmail", async (c) => {
    const tenantId = c.req.header("X-Tenant-Id")!;
    const itemId = c.req.param("id");
    const db = ctx.db;

    const rows = await db.execute(sql`
      SELECT id, source, source_id FROM inbox_items
      WHERE id = ${itemId} AND tenant_id = ${tenantId}
      LIMIT 1
    `) as unknown as Array<{ id: string; source: string; source_id: string }>;

    const item = rows[0];
    if (!item) return c.json({ error: "Item not found" }, 404);
    if (item.source !== "gmail") return c.json({ error: "Gmail archive only available for Gmail items" }, 400);

    const clientResult = await getGmailClient(db, tenantId);
    if (!clientResult.gmail) return c.json({ error: clientResult.error }, 400);

    // Archive in Gmail
    const result = await clientResult.gmail.executeAction("archive_email", { messageId: item.source_id });
    if (!result.success) return c.json({ error: result.error }, 502);

    // Also archive in CRM
    await db.execute(sql`
      UPDATE inbox_items SET status = 'archived', archived_at = now(), updated_at = now()
      WHERE id = ${itemId}
    `);

    return c.json({ ok: true });
  });

  /**
   * POST /inbox/sync
   *
   * Manually triggers an email sync — fetches latest emails from Gmail,
   * creates inbox items, and backfills threads.
   */
  app.post("/sync", async (c) => {
    const tenantId = c.req.header("X-Tenant-Id")!;
    const db = ctx.db;

    const clientResult = await getGmailClient(db, tenantId);
    if (!clientResult.gmail) return c.json({ error: clientResult.error }, 400);
    const gmail = clientResult.gmail;

    // Fetch latest emails
    const listResult = await gmail.executeAction("list_emails", { maxResults: 20 });
    if (!listResult.success || !listResult.data) {
      return c.json({ error: listResult.error ?? "Failed to fetch emails" }, 502);
    }

    const messages = (listResult.data as any).messages as Array<{
      id: string; threadId: string; subject: string | null;
      from: string | null; body: string | null; bodyHtml: string | null;
      snippet: string | null; date: string | null;
    }>;

    let created = 0;
    const itemIds: string[] = [];

    for (const msg of messages) {
      // Dedup by source_id
      const existing = await db.execute(sql`
        SELECT id FROM inbox_items
        WHERE tenant_id = ${tenantId} AND source = 'gmail' AND source_id = ${msg.id}
        LIMIT 1
      `) as unknown as Array<{ id: string }>;
      if (existing.length > 0) continue;

      // Create inbox item
      const itemId = crypto.randomUUID();
      await db.execute(sql`
        INSERT INTO inbox_items (id, tenant_id, source, source_id, subject, body, "from", status, metadata, created_at, updated_at)
        VALUES (${itemId}, ${tenantId}, 'gmail', ${msg.id},
          ${msg.subject ?? "No subject"}, ${msg.body}, ${msg.from},
          'unread', ${JSON.stringify({ threadId: msg.threadId, bodyHtml: msg.bodyHtml })}::jsonb,
          now(), now())
      `);
      created++;
      itemIds.push(itemId);
    }

    // Backfill threads for newly created items
    let threadsBackfilled = 0;
    for (const itemId of itemIds) {
      const itemRows = await db.execute(sql`
        SELECT metadata FROM inbox_items WHERE id = ${itemId}
      `) as unknown as Array<{ metadata: Record<string, unknown> }>;
      const threadId = itemRows[0]?.metadata?.threadId as string;
      if (!threadId) continue;

      const threadResult = await gmail.executeAction("get_thread", { threadId });
      if (!threadResult.success || !threadResult.data) continue;

      const threadMessages = (threadResult.data as any).messages;
      const latestMsg = threadMessages[threadMessages.length - 1];

      await db.execute(sql`
        UPDATE inbox_items
        SET metadata = COALESCE(metadata, '{}'::jsonb) || ${JSON.stringify({ threadMessages, bodyHtml: latestMsg?.bodyHtml })}::jsonb,
          body = COALESCE(${latestMsg?.bodyPlain}, body),
          updated_at = now()
        WHERE id = ${itemId}
      `);
      threadsBackfilled++;
    }

    // Emit events so the Email Triage agent wakes up
    if (created > 0 && ctx.emitEvent) {
      for (const itemId of itemIds) {
        ctx.emitEvent("inbox.item_created", tenantId, { itemId, source: "gmail" });
      }
    }

    return c.json({ created, threads: threadsBackfilled });
  });

  /**
   * POST /inbox/backfill-threads
   *
   * Fetches full threads from Gmail for all gmail inbox items missing thread data.
   * Groups by threadId to avoid redundant API calls.
   */
  app.post("/backfill-threads", async (c) => {
    const tenantId = c.req.header("X-Tenant-Id")!;
    const db = ctx.db;

    const clientResult = await getGmailClient(db, tenantId);
    if (!clientResult.gmail) return c.json({ error: clientResult.error }, 400);
    const gmail = clientResult.gmail;

    // Find gmail items without thread data
    const items = await db.execute(sql`
      SELECT id, source_id, metadata FROM inbox_items
      WHERE tenant_id = ${tenantId}
        AND source = 'gmail'
        AND source_id IS NOT NULL
        AND (metadata->>'threadMessages') IS NULL
      ORDER BY created_at DESC
      LIMIT 30
    `) as unknown as Array<{ id: string; source_id: string; metadata: Record<string, unknown> }>;

    // Resolve threadId for items that don't have it (e.g. agent PATCH overwrote original metadata)
    // Gmail message IDs can be used to fetch the message which gives us the threadId
    const byThread = new Map<string, string[]>();
    for (const item of items) {
      let tid = (item.metadata?.threadId as string) ?? null;
      if (!tid) {
        // Fetch message metadata to get threadId
        const msgResult = await gmail.executeAction("read_email", { messageId: item.source_id });
        if (msgResult.success && msgResult.data) {
          tid = (msgResult.data as any).threadId ?? null;
          // Persist threadId in metadata so we don't have to fetch again
          if (tid) {
            await db.execute(sql`
              UPDATE inbox_items
              SET metadata = COALESCE(metadata, '{}'::jsonb) || ${JSON.stringify({ threadId: tid })}::jsonb
              WHERE id = ${item.id}
            `);
          }
        }
      }
      if (!tid) continue;
      const ids = byThread.get(tid) ?? [];
      ids.push(item.id);
      byThread.set(tid, ids);
    }

    let updated = 0;
    const errors: string[] = [];

    for (const [threadId, itemIds] of byThread) {
      try {
        const result = await gmail.executeAction("get_thread", { threadId });
        if (!result.success || !result.data) {
          errors.push(`${threadId}: ${result.error ?? "no data"}`);
          continue;
        }

        const threadMessages = (result.data as any).messages;
        const latestMsg = threadMessages[threadMessages.length - 1];
        const bodyPlain = latestMsg?.bodyPlain ?? null;
        const bodyHtml = latestMsg?.bodyHtml ?? null;
        const patch = JSON.stringify({ threadMessages, bodyHtml });

        for (const id of itemIds) {
          await db.execute(sql`
            UPDATE inbox_items
            SET metadata = COALESCE(metadata, '{}'::jsonb) || ${patch}::jsonb,
              body = COALESCE(${bodyPlain}, body),
              updated_at = now()
            WHERE id = ${id}
          `);
          updated++;
        }
      } catch (err) {
        errors.push(`${threadId}: ${(err as Error).message}`);
      }
    }

    return c.json({ updated, threads: byThread.size, errors: errors.length > 0 ? errors : undefined });
  });

  /**
   * POST /inbox/backfill-bodies (legacy — kept for compatibility)
   */
  app.post("/backfill-bodies", async (c) => {
    const tenantId = c.req.header("X-Tenant-Id")!;
    const db = ctx.db;

    const clientResult = await getGmailClient(db, tenantId);
    if (!clientResult.gmail) return c.json({ error: clientResult.error }, 400);
    const gmail = clientResult.gmail;

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

export function agentDocs(url: string): string {
  const tid = "$BORINGOS_TENANT_ID";
  return `**Inbox** — unified view of Gmail threads routed to the CRM. Use this to list items, read full email threads, reply, or archive Gmail items.

\`\`\`
# List items (default: unread only). status=unread|archived|all, source=gmail, limit, offset.
curl -s "${url}/api/crm/inbox?status=unread" -H "X-Tenant-Id: ${tid}"
# Read a full Gmail thread
curl -s ${url}/api/crm/inbox/ITEM_ID/thread -H "X-Tenant-Id: ${tid}"
# Reply to a Gmail thread
curl -s -X POST ${url}/api/crm/inbox/ITEM_ID/reply -H "X-Tenant-Id: ${tid}" -H "Content-Type: application/json" \\
  -d '{"body":"reply text"}'
# Archive a Gmail item (removes INBOX label in Gmail + marks archived in CRM)
curl -s -X POST ${url}/api/crm/inbox/ITEM_ID/archive-gmail -H "X-Tenant-Id: ${tid}"
\`\`\`

Item fields returned by the list endpoint: \`id, source, subject, from, status, createdAt, archivedAt\`. Typical flow: call the list endpoint → pick an item by id → read its thread → reply.`;
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
