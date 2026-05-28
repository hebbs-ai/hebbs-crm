// SPDX-License-Identifier: GPL-3.0-or-later
//
// Resolves Gmail and Calendar clients for the CRM's "google" connector
// binding, and presents the legacy `executeAction(verb, opts)` shape to
// the CRM tool layer.
//
// As of MDK Phase 0 / T0.3 (hebbs-ai/boringos#50) this file:
//
//   - No longer reads the legacy `connectors` table directly. That
//     table was dropped by the Connector SDK v2 (#60); the replacement
//     `connector_accounts` schema is owned exclusively by the
//     framework's `AuthManager`.
//   - No longer refreshes the OAuth access token by hand against
//     Google's token endpoint. AuthManager owns OAuth (proactive
//     refresh, multi-account, encrypted credentials, audit).
//   - No longer reads `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`
//     env vars. Those are read by AuthManager via
//     `googleConnector.auth[0].clientIdEnv` / `clientSecretEnv`.
//
// The CRM goes through the host's injected `getConnectorToken("google",
// "crm")` accessor on every call. The accessor returns a
// `ConnectorTokenHandle` whose `getToken()` refreshes transparently;
// the typed connector clients accept this function-shaped source
// directly (`new GmailClient(handle.getToken)`).
//
// A thin `executeAction` shim preserves the legacy CRM tool-layer
// call shape during the migration window. It translates the verb-based
// API to the new typed client methods. **To be removed when CRM tools
// are migrated to call the typed methods directly** (tracked under
// Phase 8 / T8.1 — "audit any CRM code that bypasses ModuleFactoryDeps").

import { GmailClient, CalendarClient } from "@boringos/connector-google";
import type {
  GmailMessage,
  Thread,
  CalendarEvent,
} from "@boringos/connector-google";
import type { CrmDeps } from "./tools/deps.js";

const MODULE_ID = "crm";
const PROVIDER = "google";

const NOT_CONFIGURED_ERROR = "Google connector not configured";

// ---------------------------------------------------------------------------
// Legacy result envelope kept for the shim. The CRM tool layer pattern-
// matches on `success` / `data` / `error`; preserved here so the migration
// off `executeAction` can land as a separate PR (T8.1 audit).
// ---------------------------------------------------------------------------
export type LegacyResult =
  | { success: true; data?: unknown; error?: undefined }
  | { success: false; error?: string; data?: undefined };

export interface ShimmedGmail {
  executeAction(
    action: string,
    opts: Record<string, unknown>,
  ): Promise<LegacyResult>;
}

export interface ShimmedCalendar {
  executeAction(
    action: string,
    opts: Record<string, unknown>,
  ): Promise<LegacyResult>;
}

function shimGmail(client: GmailClient): ShimmedGmail {
  return {
    async executeAction(action, opts) {
      try {
        switch (action) {
          case "read_email": {
            const msg: GmailMessage = await client.getMessage(
              String(opts.messageId),
            );
            return { success: true, data: msg };
          }
          case "get_thread": {
            const thread: Thread = await client.getThread(
              String(opts.threadId),
            );
            return { success: true, data: thread };
          }
          case "reply_email": {
            // New `replyToEmail` resolves threading + recipients from
            // the original message internally; CRM's old callers passed
            // threadId/to/subject too — those are now ignored.
            const r = await client.replyToEmail({
              messageId: String(opts.messageId),
              body: String(opts.body),
            });
            return { success: true, data: { id: r.messageId } };
          }
          case "archive_email": {
            await client.archiveMessage(String(opts.messageId));
            return { success: true };
          }
          case "list_emails": {
            const messages = await client.listMessages({
              maxResults:
                typeof opts.maxResults === "number" ? opts.maxResults : undefined,
            });
            return { success: true, data: { messages } };
          }
          default:
            return {
              success: false,
              error: `Unknown gmail action: ${action}`,
            };
        }
      } catch (e) {
        return {
          success: false,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    },
  };
}

function shimCalendar(client: CalendarClient): ShimmedCalendar {
  return {
    async executeAction(action, opts) {
      try {
        switch (action) {
          case "list_events": {
            const events: CalendarEvent[] = await client.listEvents({
              calendarId:
                typeof opts.calendarId === "string" ? opts.calendarId : undefined,
              timeMin:
                typeof opts.timeMin === "string" ? opts.timeMin : undefined,
              timeMax:
                typeof opts.timeMax === "string" ? opts.timeMax : undefined,
              maxResults:
                typeof opts.maxResults === "number" ? opts.maxResults : undefined,
            });
            return { success: true, data: { events } };
          }
          case "create_event": {
            const event = await client.createEvent(
              opts as Partial<CalendarEvent>,
            );
            return { success: true, data: event };
          }
          default:
            return {
              success: false,
              error: `Unknown calendar action: ${action}`,
            };
        }
      } catch (e) {
        return {
          success: false,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    },
  };
}

export async function getGmailClient(
  deps: CrmDeps,
): Promise<{ gmail: ShimmedGmail; error?: string } | { gmail?: undefined; error: string }> {
  const handle = await deps.getConnectorToken(PROVIDER, MODULE_ID);
  if (!handle) return { error: NOT_CONFIGURED_ERROR };
  return { gmail: shimGmail(new GmailClient(handle.getToken)) };
}

export async function getCalendarClient(
  deps: CrmDeps,
): Promise<{ calendar: ShimmedCalendar; error?: string } | { calendar?: undefined; error: string }> {
  const handle = await deps.getConnectorToken(PROVIDER, MODULE_ID);
  if (!handle) return { error: NOT_CONFIGURED_ERROR };
  return { calendar: shimCalendar(new CalendarClient(handle.getToken)) };
}
