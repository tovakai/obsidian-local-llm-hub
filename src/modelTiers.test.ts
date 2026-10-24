import { describe, expect, it } from "vitest";
import { validModelTier, resolveTierModel } from "./modelTiers";

describe("Mabel model tiers", () => {
  it("maps three independent tiers", () => {
    const models = { low: "tiny", medium: "balanced", high: "large" };
    expect(resolveTierModel("low", models, "legacy")).toBe("tiny");
    expect(resolveTierModel("medium", models, "legacy")).toBe("balanced");
    expect(resolveTierModel("high", models, "legacy")).toBe("large");
  });
  it("falls back to configured legacy model when a tier is empty", () => {
    expect(resolveTierModel("low", { low: "  " }, "mabel-qwen-64k:latest")).toBe("mabel-qwen-64k:latest");
    expect(resolveTierModel("high", undefined, "old")).toBe("old");
  });
  it("migrates invalid and missing tier to medium", () => {
    expect(validModelTier(undefined)).toBe("medium");
    expect(validModelTier("custom")).toBe("medium");
    expect(validModelTier("high")).toBe("high");
  });
});
