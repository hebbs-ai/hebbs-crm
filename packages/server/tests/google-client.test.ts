// SPDX-License-Identifier: GPL-3.0-or-later
//
// T0.3 — proves CRM's Gmail/Calendar slice routes through the new
// `deps.getConnectorToken` contract instead of the dropped `connectors`
// table. Exercises the `getGmailClient` / `getCalendarClient`
// resolvers + the `executeAction` compat shim. Live-Google end-to-end
// is Parag's manual check on the PR.

import { describe, it, expect, vi } from "vitest";
import type { ConnectorTokenHandle } from "@boringos/module-sdk";
import {
  getGmailClient,
  getCalendarClient,
} from "../src/google-client.js";
import type { CrmDeps, GetConnectorToken } from "../src/tools/deps.js";

function buildDeps(getConnectorToken: GetConnectorToken): CrmDeps {
  return {
    db: {} as never,
    getEventBus: () => null,
    getConnectorToken,
  };
}

const tokenHandle: ConnectorTokenHandle = {
  getToken: async () => "access-token-value",
};

describe("CRM google-client — T0.3 contract migration", () => {
  it("getGmailClient returns the not-configured error when the host has no connected account", async () => {
    const deps = buildDeps(async () => null);
    const result = await getGmailClient(deps);
    expect(result.gmail).toBeUndefined();
    expect(result.error).toBe("Google connector not configured");
  });

  it("getCalendarClient returns the not-configured error when the host has no connected account", async () => {
    const deps = buildDeps(async () => null);
    const result = await getCalendarClient(deps);
    expect(result.calendar).toBeUndefined();
    expect(result.error).toBe("Google connector not configured");
  });

  it("getGmailClient calls getConnectorToken with ('google', 'crm')", async () => {
    const tokenFn = vi.fn<GetConnectorToken>(async () => tokenHandle);
    const deps = buildDeps(tokenFn);
    const result = await getGmailClient(deps);
    expect(result.error).toBeUndefined();
    expect(result.gmail).toBeDefined();
    expect(tokenFn).toHaveBeenCalledWith("google", "crm");
  });

  it("getCalendarClient calls getConnectorToken with ('google', 'crm')", async () => {
    const tokenFn = vi.fn<GetConnectorToken>(async () => tokenHandle);
    const deps = buildDeps(tokenFn);
    const result = await getCalendarClient(deps);
    expect(result.error).toBeUndefined();
    expect(result.calendar).toBeDefined();
    expect(tokenFn).toHaveBeenCalledWith("google", "crm");
  });

  it("shimmed gmail.executeAction returns the unknown-action error envelope for unsupported verbs", async () => {
    const deps = buildDeps(async () => tokenHandle);
    const { gmail } = await getGmailClient(deps);
    expect(gmail).toBeDefined();
    const result = await gmail!.executeAction("teleport", {});
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/Unknown gmail action/);
    }
  });

  it("shimmed calendar.executeAction returns the unknown-action error envelope for unsupported verbs", async () => {
    const deps = buildDeps(async () => tokenHandle);
    const { calendar } = await getCalendarClient(deps);
    expect(calendar).toBeDefined();
    const result = await calendar!.executeAction("teleport", {});
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/Unknown calendar action/);
    }
  });
});
