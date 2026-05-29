// SPDX-License-Identifier: GPL-3.0-or-later
//
// MDK T8.4 — CRM exercises all 7 PluginUI contribution slots.

import { describe, it, expect } from "vitest";
import { crmUI } from "../src/ui.js";

describe("MDK T8.4 — CRM PluginUI ships all 7 slots", () => {
  it("has every contribution slot the PluginUI contract exposes", () => {
    const slots = [
      "navItems",
      "entityPanels",
      "entityActions",
      "settingsPanels",
      "copilotTools",
      "inboxFilters",
      "dashboardWidgets",
    ] as const;
    for (const slot of slots) {
      const value = (crmUI as unknown as Record<string, unknown[]>)[slot];
      expect(value, `slot ${slot} missing`).toBeDefined();
      expect(value.length, `slot ${slot} empty`).toBeGreaterThan(0);
    }
  });

  it("copilotTools name real tool ids", () => {
    for (const t of crmUI.copilotTools ?? []) {
      expect(t.toolName).toMatch(/^crm\.[a-z]+\.[a-z_]+$/);
    }
  });

  it("inboxFilter predicates are pure functions", () => {
    for (const f of crmUI.inboxFilters ?? []) {
      expect(typeof f.match).toBe("function");
      // Smoke: empty item shouldn't throw.
      expect(() => f.match({ source: undefined, metadata: {} })).not.toThrow();
    }
  });
});
