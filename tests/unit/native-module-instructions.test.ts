/**
 * Mode-separated instruction worlds: legacy modules ride the flat
 * customTools.modules keys; native modules live under
 * customTools.native.instructions.modules. Under test: enabled native
 * module prompts join in record order, and a module without a native
 * prompt delivers nothing.
 */

import { describe, it, expect } from "vitest";
import { buildNativeModuleInstructions } from "../../src/api/instructions.js";

describe("buildNativeModuleInstructions", () => {
  it("returns undefined when the native module map is missing", () => {
    expect(buildNativeModuleInstructions(undefined)).toBeUndefined();
  });

  it("returns undefined when no module is enabled", () => {
    expect(
      buildNativeModuleInstructions({
        homeAssistant: { enabled: false, prompt: "text" },
      }),
    ).toBeUndefined();
  });

  it("returns undefined when enabled modules carry no prompt", () => {
    expect(
      buildNativeModuleInstructions({ homeAssistant: { enabled: true } }),
    ).toBeUndefined();
  });

  it("joins enabled module prompts with headers", () => {
    const out = buildNativeModuleInstructions({
      alpha: { enabled: true, prompt: "Alpha workflow" },
      beta: { enabled: true, prompt: "  Beta workflow  " },
      gamma: { enabled: false, prompt: "ignored" },
    });
    expect(out).toContain("# alpha\nAlpha workflow");
    expect(out).toContain("# beta\nBeta workflow");
    expect(out).not.toContain("gamma");
  });

  it("carries no legacy protocol boilerplate by construction", () => {
    const out = buildNativeModuleInstructions({
      homeAssistant: {
        enabled: true,
        prompt: "Call ha_get_skill_guide() first.",
      },
    });
    expect(out).toContain("ha_get_skill_guide");
    expect(out).not.toContain("```json");
    expect(out).not.toContain("code block");
  });
});
