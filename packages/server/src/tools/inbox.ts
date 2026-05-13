// CRM inbox tools — list / get_thread / reply / archive / sync /
// backfill_threads / backfill_bodies. Dispatched at
// /api/tools/crm.inbox.<name>. tenantId comes from the JWT context.
//
// The inbox uses the framework's `inbox_items` table — queried via
// raw SQL since there's no Drizzle table import shared from the
// framework. Gmail integration delegates to the GmailClient helper
// in `../google-client.ts` (kept as-is from the v1 routes).

import { z } from "@boringos/module-sdk";
import type { Tool, ToolContext, ToolResult } from "@boringos/module-sdk";
import { sql } from "drizzle-orm";
import { getGmailClient } from "../google-client.js";
import { logActivity } from "../activity-logger.js";
import { resolveInboxItemEntities } from "../inbox-resolve.js";
import { ensureContactForInbound } from "../lead-ingestion.js";
import { emitCrm, type CrmDeps } from "./deps.js";

export function createInboxTools(deps: CrmDeps): Tool[] {
  const list: Tool = {
    name: "inbox.list",
    description:
      "List inbox items for the tenant. Defaults to unread/unresolved items (status != archived) so agents can find threads needing attention. status: unread|archived|all (default unread); source filter optional.",
    inputs: z.object({
      status: z.enum(["unread", "archived", "all"]).optional(),
      source: z.string().optional(),
      limit: z.number().int().positive().max(500).optional(),
      offset: z.number().int().nonnegative().optional(),
    }),
    async handler(
      input: {
        status?: "unread" | "archived" | "all";
        source?: string;
        limit?: number;
        offset?: number;
      },
      ctx: ToolContext,
    ): Promise<ToolResult> {
      const status = input.status ?? "unread";
      const limit = input.limit ?? 25;
      const offset = input.offset ?? 0;

      const filters = [sql`tenant_id = ${ctx.tenantId}`];
      if (status === "unread") filters.push(sql`status != 'archived'`);
      else if (status !== "all") filters.push(sql`status = ${status}`);
      if (input.source) filters.push(sql`source = ${input.source}`);

      const whereClause = filters.reduce((acc, f, i) =>
        i === 0 ? f : sql`${acc} AND ${f}`,
      );

      const [rows, totalRows] = (await Promise.all([
        deps.db.execute(sql`
          SELECT id, source, subject, "from", status,
                 created_at as "createdAt", archived_at as "archivedAt"
          FROM inbox_items
          WHERE ${whereClause}
          ORDER BY created_at DESC
          LIMIT ${limit} OFFSET ${offset}
        `),
        deps.db.execute(sql`
          SELECT count(*)::int AS n
          FROM inbox_items
          WHERE ${whereClause}
        `),
      ])) as unknown as [
        Array<Record<string, unknown>>,
        Array<{ n: number }>,
      ];

      return {
        ok: true,
        result: {
          data: rows,
          total: totalRows[0]?.n ?? rows.length,
          limit,
          offset,
        },
      };
    },
  };

  const getThread: Tool = {
    name: "inbox.get_thread",
    description:
      "Fetch the full Gmail thread for an inbox item. Caches the thread payload + bodyHtml in metadata and writes the latest plain-text body back to the row. Returns { threadMessages }.",
    inputs: z.object({ id: z.string().uuid() }),
    async handler(
      input: { id: string },
      ctx: ToolContext,
    ): Promise<ToolResult> {
      const itemId = input.id;
      const db = deps.db;

      const rows = (await db.execute(sql`
        SELECT id, source, source_id, metadata FROM inbox_items
        WHERE id = ${itemId} AND tenant_id = ${ctx.tenantId}
        LIMIT 1
      `)) as unknown as Array<{
        id: string;
        source: string;
        source_id: string | null;
        metadata: Record<string, unknown> | null;
      }>;

      const item = rows[0];
      if (!item) {
        return {
          ok: false,
          error: { code: "not_found", message: "Item not found", retryable: false },
        };
      }
      if (item.source !== "gmail") {
        return {
          ok: false,
          error: {
            code: "invalid_input",
            message: "Thread view only available for Gmail",
            retryable: false,
          },
        };
      }

      // Return cached thread if available.
      const meta = item.metadata ?? {};
      if (meta.threadMessages) {
        return { ok: true, result: { threadMessages: meta.threadMessages } };
      }

      let threadId = (meta.threadId as string) ?? null;

      const clientResult = await getGmailClient(db, ctx.tenantId);
      if (!clientResult.gmail) {
        return {
          ok: false,
          error: {
            code: "upstream_unavailable",
            message: clientResult.error ?? "Gmail unavailable",
            retryable: true,
          },
        };
      }

      if (!threadId && item.source_id) {
        const msgResult = await clientResult.gmail.executeAction("read_email", {
          messageId: item.source_id,
        });
        if (msgResult.success && msgResult.data) {
          threadId = (msgResult.data as any).threadId ?? null;
          if (threadId) {
            await db.execute(sql`
              UPDATE inbox_items
              SET metadata = COALESCE(metadata, '{}'::jsonb) || ${JSON.stringify({ threadId })}::jsonb
              WHERE id = ${itemId} AND tenant_id = ${ctx.tenantId}
            `);
          }
        }
      }

      if (!threadId) {
        return {
          ok: false,
          error: {
            code: "not_found",
            message: "No thread ID available",
            retryable: false,
          },
        };
      }

      const result = await clientResult.gmail.executeAction("get_thread", { threadId });
      if (!result.success || !result.data) {
        return {
          ok: false,
          error: {
            code: "upstream_unavailable",
            message: result.error ?? "Failed to fetch thread",
            retryable: true,
          },
        };
      }

      const threadMessages = (result.data as any).messages;
      const latestMsg = threadMessages[threadMessages.length - 1];
      const bodyPlain = latestMsg?.bodyPlain ?? null;
      const bodyHtml = latestMsg?.bodyHtml ?? null;

      await db.execute(sql`
        UPDATE inbox_items
        SET metadata = COALESCE(metadata, '{}'::jsonb)
          || ${JSON.stringify({ threadMessages, bodyHtml })}::jsonb,
          body = COALESCE(${bodyPlain}, body),
          updated_at = now()
        WHERE id = ${itemId} AND tenant_id = ${ctx.tenantId}
      `);

      return { ok: true, result: { threadMessages } };
    },
  };

  const reply: Tool = {
    name: "inbox.reply",
    description:
      "Send a reply to a Gmail thread for the inbox item. Uses the thread's stored threadId and the original sender as the To address. Records an 'email' activity. Returns { messageId }.",
    inputs: z.object({
      id: z.string().uuid(),
      body: z.string().min(1),
      /** Optional actor user id for activity attribution; agents may
       * omit (falls back to null). */
      actorUserId: z.string().uuid().optional(),
    }),
    async handler(
      input: { id: string; body: string; actorUserId?: string },
      ctx: ToolContext,
    ): Promise<ToolResult> {
      const itemId = input.id;
      const db = deps.db;
      const replyBody = input.body;

      if (!replyBody?.trim()) {
        return {
          ok: false,
          error: {
            code: "invalid_input",
            message: "Reply body is required",
            retryable: false,
          },
        };
      }

      const rows = (await db.execute(sql`
        SELECT id, source, source_id, subject, "from", metadata FROM inbox_items
        WHERE id = ${itemId} AND tenant_id = ${ctx.tenantId}
        LIMIT 1
      `)) as unknown as Array<{
        id: string;
        source: string;
        source_id: string;
        subject: string;
        from: string;
        metadata: Record<string, unknown> | null;
      }>;

      const item = rows[0];
      if (!item) {
        return {
          ok: false,
          error: { code: "not_found", message: "Item not found", retryable: false },
        };
      }
      if (item.source !== "gmail") {
        return {
          ok: false,
          error: {
            code: "invalid_input",
            message: "Reply only available for Gmail",
            retryable: false,
          },
        };
      }

      const clientResult = await getGmailClient(db, ctx.tenantId);
      if (!clientResult.gmail) {
        return {
          ok: false,
          error: {
            code: "upstream_unavailable",
            message: clientResult.error ?? "Gmail unavailable",
            retryable: true,
          },
        };
      }

      const toEmail = item.from.match(/<([^>]+)>/)?.[1] ?? item.from;
      const threadId = (item.metadata?.threadId as string) ?? null;

      const result = await clientResult.gmail.executeAction("reply_email", {
        messageId: item.source_id,
        threadId: threadId ?? "",
        to: toEmail,
        subject: item.subject ?? "",
        body: replyBody,
      });

      if (!result.success) {
        return {
          ok: false,
          error: {
            code: "upstream_unavailable",
            message: result.error ?? "Failed to send reply",
            retryable: true,
          },
        };
      }

      const messageId = (result.data as { id?: string } | undefined)?.id;

      // Resolve the contact/deal/company so the activity lands in the
      // right timelines. The lens stores contactMatch/dealContext in
      // metadata once it's run — `resolveInboxItemEntities` reads that
      // first and falls back to a `from`-header email lookup.
      const linked = await resolveInboxItemEntities(db, ctx.tenantId, itemId);
      await logActivity({
        db,
        tenantId: ctx.tenantId,
        userId: input.actorUserId,
        type: "email",
        subject: `Replied: ${item.subject ?? "(no subject)"}`,
        body: replyBody,
        contactId: linked.contactId,
        dealId: linked.dealId,
        companyId: linked.companyId,
      });

      // Tell anyone interested (workflows, list views) that the inbox
      // row just got a fresh outbound message attached.
      emitCrm(deps, "inbox.reply_sent", ctx.tenantId, {
        itemId,
        to: toEmail,
        messageId,
        contactId: linked.contactId,
        dealId: linked.dealId,
        companyId: linked.companyId,
      });

      return {
        ok: true,
        result: {
          messageId,
          to: toEmail,
          contactId: linked.contactId,
          dealId: linked.dealId,
          companyId: linked.companyId,
        },
      };
    },
  };

  const archive: Tool = {
    name: "inbox.archive",
    description:
      "Archive a Gmail inbox item: removes the INBOX label in Gmail and marks the CRM inbox row as archived.",
    inputs: z.object({ id: z.string().uuid() }),
    async handler(
      input: { id: string },
      ctx: ToolContext,
    ): Promise<ToolResult> {
      const itemId = input.id;
      const db = deps.db;

      const rows = (await db.execute(sql`
        SELECT id, source, source_id FROM inbox_items
        WHERE id = ${itemId} AND tenant_id = ${ctx.tenantId}
        LIMIT 1
      `)) as unknown as Array<{ id: string; source: string; source_id: string }>;

      const item = rows[0];
      if (!item) {
        return {
          ok: false,
          error: { code: "not_found", message: "Item not found", retryable: false },
        };
      }
      if (item.source !== "gmail") {
        return {
          ok: false,
          error: {
            code: "invalid_input",
            message: "Gmail archive only available for Gmail items",
            retryable: false,
          },
        };
      }

      const clientResult = await getGmailClient(db, ctx.tenantId);
      if (!clientResult.gmail) {
        return {
          ok: false,
          error: {
            code: "upstream_unavailable",
            message: clientResult.error ?? "Gmail unavailable",
            retryable: true,
          },
        };
      }

      const result = await clientResult.gmail.executeAction("archive_email", {
        messageId: item.source_id,
      });
      if (!result.success) {
        return {
          ok: false,
          error: {
            code: "upstream_unavailable",
            message: result.error ?? "Failed to archive in Gmail",
            retryable: true,
          },
        };
      }

      await db.execute(sql`
        UPDATE inbox_items SET status = 'archived', archived_at = now(), updated_at = now()
        WHERE id = ${itemId} AND tenant_id = ${ctx.tenantId}
      `);

      emitCrm(deps, "inbox.archived", ctx.tenantId, { itemId });

      return { ok: true, result: { archived: true, id: itemId } };
    },
  };

  const sync: Tool = {
    name: "inbox.sync",
    description:
      "Pull latest emails from Gmail, dedupe against existing inbox_items, insert new rows, backfill thread payloads, and emit `inbox.item_created` per new item so the Email Triage agent wakes up.",
    inputs: z.object({
      /** Optional cap on Gmail messages to fetch (default 20). */
      maxResults: z.number().int().positive().max(100).optional(),
    }),
    async handler(
      input: { maxResults?: number },
      ctx: ToolContext,
    ): Promise<ToolResult> {
      const db = deps.db;
      const maxResults = input.maxResults ?? 20;

      const clientResult = await getGmailClient(db, ctx.tenantId);
      if (!clientResult.gmail) {
        return {
          ok: false,
          error: {
            code: "upstream_unavailable",
            message: clientResult.error ?? "Gmail unavailable",
            retryable: true,
          },
        };
      }
      const gmail = clientResult.gmail;

      const listResult = await gmail.executeAction("list_emails", { maxResults });
      if (!listResult.success || !listResult.data) {
        return {
          ok: false,
          error: {
            code: "upstream_unavailable",
            message: listResult.error ?? "Failed to fetch emails",
            retryable: true,
          },
        };
      }

      const messages = (listResult.data as any).messages as Array<{
        id: string;
        threadId: string;
        subject: string | null;
        from: string | null;
        body: string | null;
        bodyHtml: string | null;
        snippet: string | null;
        date: string | null;
      }>;

      let newCount = 0;
      const itemIds: string[] = [];

      for (const msg of messages) {
        const existing = (await db.execute(sql`
          SELECT id FROM inbox_items
          WHERE tenant_id = ${ctx.tenantId} AND source = 'gmail' AND source_id = ${msg.id}
          LIMIT 1
        `)) as unknown as Array<{ id: string }>;
        if (existing.length > 0) continue;

        const itemId = crypto.randomUUID();
        await db.execute(sql`
          INSERT INTO inbox_items (id, tenant_id, source, source_id, subject, body, "from", status, metadata, created_at, updated_at)
          VALUES (${itemId}, ${ctx.tenantId}, 'gmail', ${msg.id},
            ${msg.subject ?? "No subject"}, ${msg.body}, ${msg.from},
            'unread', ${JSON.stringify({ threadId: msg.threadId, bodyHtml: msg.bodyHtml })}::jsonb,
            now(), now())
        `);
        newCount++;
        itemIds.push(itemId);

        // Resolve (or auto-create) the sender's CRM tuple. New senders
        // get a contact + company + stub deal; known senders short-
        // circuit. Either way we end with ids we can attach to the
        // inbound-email activity below.
        const linked = await ensureContactForInbound(
          deps,
          ctx.tenantId,
          msg.from,
          msg.subject,
        );
        if (linked.contactId) {
          await logActivity({
            db: deps.db,
            tenantId: ctx.tenantId,
            type: "email",
            subject: `Received: ${msg.subject ?? "(no subject)"}`,
            body: msg.snippet ?? msg.body ?? undefined,
            contactId: linked.contactId,
            dealId: linked.dealId,
            companyId: linked.companyId,
          });
          // Stamp the inbox row with the resolved tuple so the lens (and
          // any downstream tools) don't have to re-do the lookup.
          await deps.db.execute(sql`
            UPDATE inbox_items
            SET metadata = COALESCE(metadata, '{}'::jsonb) || ${JSON.stringify({
              crmLens: {
                contactMatch: linked.contactId ? { id: linked.contactId } : null,
                dealContext: linked.dealId ? { id: linked.dealId } : null,
                companyMatch: linked.companyId ? { id: linked.companyId } : null,
                autoCreated: linked.created,
              },
            })}::jsonb
            WHERE id = ${itemId} AND tenant_id = ${ctx.tenantId}
          `);
        }
      }

      // Backfill threads for newly created items.
      let threadsBackfilled = 0;
      for (const itemId of itemIds) {
        const itemRows = (await db.execute(sql`
          SELECT metadata FROM inbox_items
          WHERE id = ${itemId} AND tenant_id = ${ctx.tenantId}
          LIMIT 1
        `)) as unknown as Array<{ metadata: Record<string, unknown> }>;
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
          WHERE id = ${itemId} AND tenant_id = ${ctx.tenantId}
        `);
        threadsBackfilled++;
      }

      // Emit one event per new item so the Email Triage agent wakes.
      for (const itemId of itemIds) {
        emitCrm(deps, "inbox.item_created", ctx.tenantId, {
          itemId,
          source: "gmail",
        });
      }

      return {
        ok: true,
        result: {
          syncedCount: messages.length,
          newCount,
          threadsBackfilled,
          itemIds,
        },
      };
    },
  };

  const backfillThreads: Tool = {
    name: "inbox.backfill_threads",
    description:
      "Fetch full Gmail thread payloads for all gmail inbox items missing thread data. Groups by threadId to avoid redundant API calls. Resolves missing threadIds via read_email when needed.",
    inputs: z.object({
      /** Cap on items inspected (default 30). */
      limit: z.number().int().positive().max(200).optional(),
    }),
    async handler(
      input: { limit?: number },
      ctx: ToolContext,
    ): Promise<ToolResult> {
      const db = deps.db;
      const limit = input.limit ?? 30;

      const clientResult = await getGmailClient(db, ctx.tenantId);
      if (!clientResult.gmail) {
        return {
          ok: false,
          error: {
            code: "upstream_unavailable",
            message: clientResult.error ?? "Gmail unavailable",
            retryable: true,
          },
        };
      }
      const gmail = clientResult.gmail;

      const items = (await db.execute(sql`
        SELECT id, source_id, metadata FROM inbox_items
        WHERE tenant_id = ${ctx.tenantId}
          AND source = 'gmail'
          AND source_id IS NOT NULL
          AND (metadata->>'threadMessages') IS NULL
        ORDER BY created_at DESC
        LIMIT ${limit}
      `)) as unknown as Array<{
        id: string;
        source_id: string;
        metadata: Record<string, unknown>;
      }>;

      // Resolve threadId for items lacking it (e.g. agent PATCH
      // overwrote original metadata). Group by thread to dedupe API
      // calls.
      const byThread = new Map<string, string[]>();
      for (const item of items) {
        let tid = (item.metadata?.threadId as string) ?? null;
        if (!tid) {
          const msgResult = await gmail.executeAction("read_email", {
            messageId: item.source_id,
          });
          if (msgResult.success && msgResult.data) {
            tid = (msgResult.data as any).threadId ?? null;
            if (tid) {
              await db.execute(sql`
                UPDATE inbox_items
                SET metadata = COALESCE(metadata, '{}'::jsonb) || ${JSON.stringify({ threadId: tid })}::jsonb
                WHERE id = ${item.id} AND tenant_id = ${ctx.tenantId}
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
              WHERE id = ${id} AND tenant_id = ${ctx.tenantId}
            `);
            updated++;
          }
        } catch (err) {
          errors.push(`${threadId}: ${(err as Error).message}`);
        }
      }

      return {
        ok: true,
        result: {
          updated,
          threads: byThread.size,
          errors: errors.length > 0 ? errors : undefined,
        },
      };
    },
  };

  const backfillBodies: Tool = {
    name: "inbox.backfill_bodies",
    description:
      "Legacy body fetch — pulls plain-text bodies for high-signal unread/read gmail items (agent score >= 50 or no analysis yet) plus the 3 most recently archived items. Kept for backwards compatibility.",
    inputs: z.object({}),
    async handler(_input: Record<string, never>, ctx: ToolContext): Promise<ToolResult> {
      const db = deps.db;

      const clientResult = await getGmailClient(db, ctx.tenantId);
      if (!clientResult.gmail) {
        return {
          ok: false,
          error: {
            code: "upstream_unavailable",
            message: clientResult.error ?? "Gmail unavailable",
            retryable: true,
          },
        };
      }
      const gmail = clientResult.gmail;

      const needsAttention = (await db.execute(sql`
        SELECT id, source_id FROM inbox_items
        WHERE tenant_id = ${ctx.tenantId}
          AND source = 'gmail'
          AND status IN ('unread', 'read')
          AND source_id IS NOT NULL
          AND ((metadata->'agentAnalysis'->>'score')::int >= 50
            OR (metadata->>'agentAnalysis') IS NULL)
      `)) as unknown as Array<{ id: string; source_id: string }>;

      const topArchived = (await db.execute(sql`
        SELECT id, source_id FROM inbox_items
        WHERE tenant_id = ${ctx.tenantId}
          AND source = 'gmail'
          AND status = 'archived'
          AND source_id IS NOT NULL
        ORDER BY created_at DESC
        LIMIT 3
      `)) as unknown as Array<{ id: string; source_id: string }>;

      const candidates = [...needsAttention, ...topArchived];
      let updated = 0;
      const errors: string[] = [];

      for (const item of candidates) {
        try {
          const result = await gmail.executeAction("read_email", {
            messageId: item.source_id,
          });
          if (!result.success || !result.data) {
            errors.push(`${item.source_id}: ${result.error ?? "no data"}`);
            continue;
          }

          const payload = (result.data as any).payload;
          const body = extractBodyFromPayload(payload);
          if (!body) continue;

          await db.execute(sql`
            UPDATE inbox_items SET body = ${body}, updated_at = now()
            WHERE id = ${item.id} AND tenant_id = ${ctx.tenantId}
          `);
          updated++;
        } catch (err) {
          errors.push(`${item.source_id}: ${(err as Error).message}`);
        }
      }

      return {
        ok: true,
        result: {
          updated,
          total: candidates.length,
          errors: errors.length > 0 ? errors : undefined,
        },
      };
    },
  };

  // Lightweight one-off ingest path: lets the shell / webhooks / tests
  // hand a synthetic email straight into the CRM without going through
  // Gmail. Mirrors the per-message logic in `inbox.sync` (dedupe on
  // source/source_id, auto-create lead, log inbound activity, emit the
  // event so triage / lens agents wake).
  const ingest: Tool = {
    name: "inbox.ingest",
    description:
      "Insert a single inbound email into the inbox (deduped by source_id) and run the same lead-resolution + activity-logging as `inbox.sync`. Use for webhooks, manual paste-ins, and smoke tests where Gmail isn't connected. Returns the new item id plus the resolved/created CRM tuple.",
    inputs: z.object({
      from: z.string().min(1),
      subject: z.string().optional(),
      body: z.string().optional(),
      source: z.string().optional(),
      sourceId: z.string().optional(),
    }),
    async handler(
      input: {
        from: string;
        subject?: string;
        body?: string;
        source?: string;
        sourceId?: string;
      },
      ctx: ToolContext,
    ): Promise<ToolResult> {
      const db = deps.db;
      const source = input.source ?? "manual";
      const sourceId = input.sourceId ?? `manual-${crypto.randomUUID()}`;

      const existing = (await db.execute(sql`
        SELECT id FROM inbox_items
        WHERE tenant_id = ${ctx.tenantId} AND source = ${source} AND source_id = ${sourceId}
        LIMIT 1
      `)) as unknown as Array<{ id: string }>;
      if (existing[0]) {
        return {
          ok: true,
          result: {
            itemId: existing[0].id,
            duplicate: true,
          },
        };
      }

      const itemId = crypto.randomUUID();
      await db.execute(sql`
        INSERT INTO inbox_items (id, tenant_id, source, source_id, subject, body, "from", status, metadata, created_at, updated_at)
        VALUES (${itemId}, ${ctx.tenantId}, ${source}, ${sourceId},
          ${input.subject ?? "No subject"}, ${input.body ?? null}, ${input.from},
          'unread', '{}'::jsonb, now(), now())
      `);

      const linked = await ensureContactForInbound(
        deps,
        ctx.tenantId,
        input.from,
        input.subject,
      );

      if (linked.contactId) {
        await logActivity({
          db,
          tenantId: ctx.tenantId,
          type: "email",
          subject: `Received: ${input.subject ?? "(no subject)"}`,
          body: input.body ?? undefined,
          contactId: linked.contactId,
          dealId: linked.dealId,
          companyId: linked.companyId,
        });
        await db.execute(sql`
          UPDATE inbox_items
          SET metadata = COALESCE(metadata, '{}'::jsonb) || ${JSON.stringify({
            crmLens: {
              contactMatch: linked.contactId ? { id: linked.contactId } : null,
              dealContext: linked.dealId ? { id: linked.dealId } : null,
              companyMatch: linked.companyId ? { id: linked.companyId } : null,
              autoCreated: linked.created,
            },
          })}::jsonb
          WHERE id = ${itemId} AND tenant_id = ${ctx.tenantId}
        `);
      }

      emitCrm(deps, "inbox.item_created", ctx.tenantId, {
        itemId,
        source,
        autoCreatedLead: linked.created,
      });

      return {
        ok: true,
        result: {
          itemId,
          duplicate: false,
          contactId: linked.contactId,
          dealId: linked.dealId,
          companyId: linked.companyId,
          autoCreated: linked.created,
          skipped: linked.skipped,
          skipReason: linked.skipReason ?? null,
        },
      };
    },
  };

  return [list, getThread, reply, archive, sync, backfillThreads, backfillBodies, ingest];
}

/** Decode base64url Gmail body data to UTF-8 string. */
function decodeBase64Url(data: string): string {
  return Buffer.from(data, "base64url").toString("utf-8");
}

/** Extract plain-text or HTML body from a Gmail message payload. */
function extractBodyFromPayload(
  payload?: {
    body?: { data?: string };
    parts?: Array<{
      mimeType: string;
      body?: { data?: string };
      parts?: Array<{ mimeType: string; body?: { data?: string } }>;
    }>;
  },
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
