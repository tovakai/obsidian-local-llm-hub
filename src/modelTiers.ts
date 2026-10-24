/** Friendly model tiers: model identifiers stay in settings, not chat UI. */
export type ModelTier = "low" | "medium" | "high";
export type ModelTierAssignments = Partial<Record<ModelTier, string>>;
export const MODEL_TIERS: readonly ModelTier[] = ["low", "medium", "high"];
export const MODEL_TIER_LABELS: Record<ModelTier, string> = {
  low: "Low", medium: "Medium", high: "High",
};

export function validModelTier(value: unknown): ModelTier {
  return value === "low" || value === "medium" || value === "high" ? value : "medium";
}

/** Missing tier mapping falls back to the existing model; no migration breakage. */
export function resolveTierModel(
  tier: ModelTier,
  assignments: ModelTierAssignments | undefined,
  fallbackModel: string,
): string {
  const mapped = assignments?.[tier]?.trim();
  return mapped || fallbackModel;
}
