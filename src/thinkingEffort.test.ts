import { describe, expect, it } from "vitest";
import { THINKING_EFFORTS, parseThinkingEffort, selectThinkingControl } from "./thinkingEffort";

describe("adaptive thinking slider", () => {
  it("has four ordered stops and migrates the legacy on/off switch", () => {
    expect(THINKING_EFFORTS).toEqual(["off", "brief", "standard", "deep"]);
    expect(parseThinkingEffort(undefined, "off")).toBe("off");
    expect(parseThinkingEffort(undefined, "on")).toBe("standard");
    expect(parseThinkingEffort("brief", "off")).toBe("brief");
  });

  it("uses named levels when the model advertises them", () => {
    const values = ["low", "medium", "high"];
    expect(selectThinkingControl("brief", values).think).toBe("low");
    expect(selectThinkingControl("standard", values).think).toBe("medium");
    expect(selectThinkingControl("deep", values).think).toBe("high");
    // A model with named levels only cannot fully disable thinking.
    expect(selectThinkingControl("off", values).think).toBe("low");
  });

  it("uses booleans and advisory text for Qwen-style models", () => {
    const values = [true, false];
    expect(selectThinkingControl("off", values)).toMatchObject({ think: false, promptHint: "" });
    expect(selectThinkingControl("brief", values)).toMatchObject({ think: true, nativeLevel: false });
    expect(selectThinkingControl("brief", values).promptHint).toContain("not a strict token limit");
    expect(selectThinkingControl("standard", values).promptHint).toBe("");
  });

  it("never guesses unsupported native levels", () => {
    const control = selectThinkingControl("brief", ["maximum"]);
    expect(control.think).toBe(true);
    expect(control.promptHint).not.toBe("");
  });
});
