import { describe, expect, it } from "vitest";
import { focusExcerpt, shortProfile, USER_MEMORY_FILES, USER_PROFILE_PATH } from "./userContext";

describe("curated user context", () => {
  it("has one canonical path shared by both clients", () => {
    expect(USER_MEMORY_FILES[0]).toBe(USER_PROFILE_PATH);
  });
  it("limits the always-loaded summary", () => {
    const result = shortProfile("a".repeat(4000));
    expect(result.length).toBeLessThan(2900);
    expect(result).toContain("[Profile shortened");
  });
  it("does not inject empty profiles", () => {
    expect(shortProfile(" \n ")).toBe("");
  });
  it("finds relevant details in long notes", () => {
    const note = "A".repeat(4000) + "\nVRChat: likes social VR.\n" + "B".repeat(4000);
    const result = focusExcerpt(note, "VRChat", 900);
    expect(result).toContain("VRChat");
    expect(result.length).toBeLessThan(1030);
  });
});
