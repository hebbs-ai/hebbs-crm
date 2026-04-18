import { sql } from "drizzle-orm";
import { GmailClient, CalendarClient } from "@boringos/connector-google";
import type { CrmContext } from "./context.js";

/**
 * Resolve a fresh Google access token for the tenant. Refreshes via the
 * stored refresh token and persists the new access token. Used by both the
 * inbox routes (Gmail thread/reply/archive) and the actions executor
 * (reply / schedule_meeting kinds).
 */
async function refreshAccessToken(db: CrmContext["db"], tenantId: string): Promise<string | null> {
  const rows = await db.execute(sql`
    SELECT id, credentials FROM connectors
    WHERE tenant_id = ${tenantId} AND kind = 'google'
    LIMIT 1
  `) as unknown as Array<{ id: string; credentials: Record<string, string> }>;

  const creds = rows[0]?.credentials;
  if (!creds?.accessToken) return null;

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
            WHERE id = ${rows[0].id}
          `);
        }
      } catch { /* fall through with existing token */ }
    }
  }

  return accessToken;
}

export async function getGmailClient(
  db: CrmContext["db"],
  tenantId: string,
): Promise<{ gmail: GmailClient; error?: string } | { gmail?: undefined; error: string }> {
  const token = await refreshAccessToken(db, tenantId);
  if (!token) return { error: "Google connector not configured" };
  return { gmail: new GmailClient(token) };
}

export async function getCalendarClient(
  db: CrmContext["db"],
  tenantId: string,
): Promise<{ calendar: CalendarClient; error?: string } | { calendar?: undefined; error: string }> {
  const token = await refreshAccessToken(db, tenantId);
  if (!token) return { error: "Google connector not configured" };
  return { calendar: new CalendarClient(token) };
}
