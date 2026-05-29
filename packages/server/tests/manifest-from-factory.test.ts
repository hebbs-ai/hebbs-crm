// SPDX-License-Identifier: GPL-3.0-or-later
//
// MDK T8.2 — `module.json` on disk is trimmed to pack-time-only
// fields; everything else flows from the factory. This test guards
// the boundary: the static manifest must NOT carry name/description/
// kind/dependsOn/provides (those come from the factory at pack
// time), and the factory must carry the canonical values.

import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createCrmModule } from "../src/module.js";

const moduleJsonPath = join(import.meta.dirname, "..", "module.json");

describe("MDK T8.2 — CRM module.json is generated from factory", () => {
  it("static module.json only carries pack-time fields", async () => {
    const text = await readFile(moduleJsonPath, "utf8");
    const json = JSON.parse(text) as Record<string, unknown>;

    // What MUST be in the static manifest (pack-time only):
    expect(json.id).toBe("crm");
    expect(json.version).toBe("0.3.0");
    expect(json.entry).toBeDefined();
    expect(json.ui).toBeDefined();
    expect(json.publisher).toBeDefined();
    expect(json.license).toBeDefined();
    expect(json.minFrameworkVersion).toBeDefined();

    // What MUST NOT be in the static manifest (factory provides them):
    expect(json.name).toBeUndefined();
    expect(json.description).toBeUndefined();
    expect(json.kind).toBeUndefined();
    expect(json.dependsOn).toBeUndefined();
    expect(json.provides).toBeUndefined();
  });

  it("factory provides the canonical fields the static manifest omits", () => {
    // The factory needs a stubbed deps for instantiation; we never
    // call any tool, just read manifest fields.
    const mod = createCrmModule({
      db: null as unknown,
    } as Parameters<typeof createCrmModule>[0]);

    expect(mod.id).toBe("crm");
    expect(mod.version).toBe("0.3.0");
    expect(mod.name).toBe("CRM");
    expect(mod.kind).toBe("module");
    expect(mod.description).toContain("Sales CRM");
    expect(mod.dependsOn).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ capability: "email-send" }),
      ]),
    );
    expect(mod.provides).toEqual(["crm-source", "crm-actions"]);
  });
});
