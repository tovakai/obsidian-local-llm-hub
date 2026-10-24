/** Persistent, independently selectable mobile conversations. */
export type MobileRole = "user" | "assistant";
export interface MobileMessage { role: MobileRole; content: string }
export interface MobileConversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: MobileMessage[];
}
export interface LegacyChatState {
  chats?: MobileConversation[];
  activeChatId?: string;
  history?: MobileMessage[];
}
export interface MigratedChatState {
  chats: MobileConversation[];
  activeChatId: string;
  migrated: boolean;
}

export function newConversation(now = Date.now()): MobileConversation {
  return {
    id: "chat-" + now + "-" + Math.random().toString(36).slice(2, 9),
    title: "New chat",
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
}

/** Upgrade v0.2's single history without discarding any messages. */
export function migrateChatState(old: LegacyChatState, now = Date.now()): MigratedChatState {
  if (Array.isArray(old.chats) && old.chats.length) {
    const chats = old.chats.filter(chat => chat && typeof chat.id === "string" && Array.isArray(chat.messages));
    if (chats.length) return {
      chats,
      activeChatId: chats.some(chat => chat.id === old.activeChatId) ? old.activeChatId! : chats[0].id,
      migrated: false,
    };
  }
  const chat = newConversation(now);
  if (Array.isArray(old.history) && old.history.length) {
    chat.messages = old.history;
    const first = old.history.find(message => message.role === "user");
    if (first) chat.title = titleFromPrompt(first.content);
  }
  return { chats: [chat], activeChatId: chat.id, migrated: true };
}

export function titleFromPrompt(text: string): string {
  const title = text.replace(/\s+/g, " ").trim();
  return title.length > 55 ? title.slice(0, 52) + "…" : title || "New chat";
}

export function appendConversation(
  chats: MobileConversation[], id: string, user: MobileMessage, assistant: MobileMessage,
  now = Date.now(),
): MobileConversation[] {
  return chats.map(chat => {
    if (chat.id !== id) return chat;
    return {
      ...chat,
      title: chat.messages.some(message => message.role === "user") ? chat.title : titleFromPrompt(user.content),
      updatedAt: now,
      messages: [...chat.messages, user, assistant].slice(-60),
    };
  }).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 50);
}
