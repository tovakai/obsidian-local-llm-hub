import { describe, expect, it } from "vitest";
import { validateMobileWrite } from "./mobileWriteSafety";
describe("mobile write approval safety", () => {
  it("allows safe Markdown notes", () => {
    expect(validateMobileWrite("Mabel/Memory/User.md", "# Updated", ".obsidian")).toBeNull();
  });
  it.each([".obsidian/plugins/evil.md", "../secret.md", "folder/../../secret.md", "/root.md", "a\\b.md", "text.txt", "LocalLlmHub/chats.md", ".obsidian-mobile/x.md"])(
    "rejects unsafe path %s", path => {
      expect(validateMobileWrite(path, "content", ".obsidian-mobile")).not.toBeNull();
    },
  );
  it("caps the amount of text Mabel can propose", () => {
    expect(validateMobileWrite("note.md", "a".repeat(40000), ".obsidian")).not.toBeNull();
  });
});
