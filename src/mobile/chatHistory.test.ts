import { describe, expect, it } from "vitest";
import { appendConversation, migrateChatState, newConversation } from "./chatHistory";

describe("mobile conversations", () => {
  it("migrates the existing mobile history without losing messages", () => {
    const history = [
      { role: "user" as const, content: "Recommend a movie" },
      { role: "assistant" as const, content: "The Substance" },
    ];
    const migrated = migrateChatState({ history }, 100);
    expect(migrated.migrated).toBe(true);
    expect(migrated.chats).toHaveLength(1);
    expect(migrated.chats[0].messages).toEqual(history);
    expect(migrated.chats[0].title).toBe("Recommend a movie");
    expect(migrated.activeChatId).toBe(migrated.chats[0].id);
  });

  it("keeps multiple conversations separate after selecting an older chat", () => {
    const first = newConversation(100);
    const second = newConversation(200);
    const updated = appendConversation(
      [first, second], first.id,
      { role: "user", content: "Old chat" },
      { role: "assistant", content: "Still here" }, 300,
    );
    expect(updated.find(chat => chat.id === second.id)?.messages).toEqual([]);
    expect(updated.find(chat => chat.id === first.id)?.messages.map(message => message.content))
      .toEqual(["Old chat", "Still here"]);
    expect(updated[0].id).toBe(first.id);
  });

  it("does not reimport stale legacy history once sessions exist", () => {
    const saved = newConversation(200);
    saved.messages = [{ role: "user", content: "New" }];
    const result = migrateChatState({
      chats: [saved],
      activeChatId: saved.id,
      history: [{ role: "user", content: "Old duplicate" }],
    });
    expect(result.chats).toEqual([saved]);
    expect(result.migrated).toBe(false);
  });

  it("uses a short, readable title for new conversations", () => {
    const chat = newConversation(100);
    const updated = appendConversation([chat], chat.id,
      { role: "user", content: "What should I watch on Friday night?  " },
      { role: "assistant", content: "A horror film." }, 101);
    expect(updated[0].title).toBe("What should I watch on Friday night?");
  });
});
