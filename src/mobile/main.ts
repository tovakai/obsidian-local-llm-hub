import { ItemView, MarkdownRenderer, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile, WorkspaceLeaf, requestUrl } from "obsidian";
import { readAvatarImage } from "../avatarImage";
import { streamOllama } from "./ollamaStream";
import { mobileToolDefinitions, executeMobileTool, type FunctionCall } from "./mobileTools";
import { appendConversation, migrateChatState, newConversation, type MobileConversation } from "./chatHistory";

type Role = "user" | "assistant";
type Message = { role: Role; content: string };
type Thinking = "default" | "off" | "on";
type MobileSettings = { baseUrl: string; model: string; thinking: Thinking; systemPrompt: string; reuseDesktopPrompt: boolean; reuseDesktopAvatar: boolean; avatar?: string; allowVaultTools: boolean; allowWebSearch: boolean; chats: MobileConversation[]; activeChatId: string };
const VIEW = "mabel-mobile-chat";
const TITLE = "Mabel Mobile";
const OPEN_LABEL = "Open Mabel Mobile";
const TALK_PLACEHOLDER = "Talk to Mabel…";
const CONFIG_NOTICE = "Configure the Ollama URL and model in Mabel Mobile settings.";
const REMOTE_HINT = "Use your private Tailscale Serve HTTPS address to reach Ollama on the desktop. Do not use Funnel.";
const defaults: MobileSettings = { baseUrl: "", model: "mabel-qwen-64k:latest", thinking: "off", systemPrompt: "", reuseDesktopPrompt: true, reuseDesktopAvatar: true, allowVaultTools: true, allowWebSearch: true, chats: [], activeChatId: "" };

class MobileChat extends ItemView {
  private transcript!: HTMLElement;
  private entry!: HTMLTextAreaElement;
  private submit!: HTMLButtonElement;
  private includeNote!: HTMLInputElement;
  private useTools!: HTMLInputElement;
  private avatar: string | undefined;
  private busy = false;

  isBusy(): boolean { return this.busy; }
  refreshConversation(): void { if (!this.busy) this.renderMessages(); }

  constructor(leaf: WorkspaceLeaf, private readonly plugin: MabelMobilePlugin) { super(leaf); }
  getViewType(): string { return VIEW; }
  getDisplayText(): string { return TITLE; }
  getIcon(): string { return "bot"; }

  async onOpen(): Promise<void> {
    const root = this.containerEl.children[1] as HTMLElement;
    root.empty();
    root.addClass("mabel-mobile");
    const header = root.createDiv({ cls: "mabel-mobile-header" });
    header.createEl("h3", { text: "Mabel" });
    const actions = header.createDiv({ cls: "mabel-mobile-header-actions" });
    actions.createEl("button", { text: "History" }).addEventListener("click", () => {
      if (!this.busy) new MobileHistoryModal(this.app, this.plugin).open();
    });
    actions.createEl("button", { text: "New chat" }).addEventListener("click", () => {
      if (!this.busy) void this.plugin.startNewChat();
    });
    this.transcript = root.createDiv({ cls: "mabel-mobile-transcript" });
    this.avatar = await this.plugin.resolveAvatar();
    this.renderMessages();
    const composer = root.createDiv({ cls: "mabel-mobile-composer" });
    const options = composer.createDiv({ cls: "mabel-mobile-options" });
    const noteLabel = options.createEl("label");
    this.includeNote = noteLabel.createEl("input", { type: "checkbox" });
    noteLabel.appendText(" Include active note");
    const toolLabel = options.createEl("label");
    this.useTools = toolLabel.createEl("input", { type: "checkbox" });
    toolLabel.appendText(" Allow read-only tools");
    const inputRow = composer.createDiv({ cls: "mabel-mobile-input-row" });
    this.entry = inputRow.createEl("textarea", { attr: { rows: "2", placeholder: TALK_PLACEHOLDER, "aria-label": "Message" } });
    this.entry.addEventListener("keydown", event => {
      if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); void this.send(); }
    });
    this.submit = inputRow.createEl("button", { text: "Send", cls: "mod-cta" });
    this.submit.addEventListener("click", () => { void this.send(); });
    await Promise.resolve();
  }

  private renderMessages(): void {
    this.transcript.empty();
    if (!this.plugin.getActiveMessages().length) {
      this.transcript.createDiv({ cls: "mabel-mobile-empty", text: "Mabel's brain lives on your desktop. Connect through Tailscale to begin." });
    } else {
      this.plugin.getActiveMessages().forEach(message => this.appendMessage(message));
    }
  }

  async refreshAvatar(): Promise<void> {
    this.avatar = await this.plugin.resolveAvatar();
    this.renderMessages();
  }

  private appendMessage(message: Message, plain = false): HTMLElement {
    this.transcript.querySelector(".mabel-mobile-empty")?.remove();
    const row = this.transcript.createDiv({ cls: "mabel-mobile-row mabel-mobile-row-" + message.role });
    if (message.role === "assistant") {
      if (this.avatar) row.createEl("img", { cls: "mabel-mobile-avatar", attr: { src: this.avatar, alt: "" } });
      else row.createDiv({ cls: "mabel-mobile-avatar mabel-mobile-avatar-fallback", text: "M" });
    }
    const bubble = row.createDiv({ cls: "mabel-mobile-bubble mabel-mobile-" + message.role });
    bubble.createDiv({ cls: "mabel-mobile-author", text: message.role === "user" ? "You" : "Mabel" });
    const content = bubble.createDiv();
    if (plain) {
      content.setText(message.content);
    } else {
      void MarkdownRenderer.render(this.app, message.content, content, "", this)
        .catch(() => content.setText(message.content));
    }
    this.transcript.scrollTop = this.transcript.scrollHeight;
    return content;
  }

  private async send(): Promise<void> {
    const text = this.entry.value.trim();
    if (!text || this.busy) return;
    if (!this.plugin.settings.baseUrl || !this.plugin.settings.model) {
      new Notice(CONFIG_NOTICE);
      return;
    }
    this.busy = true;
    this.submit.disabled = true;
    this.submit.setText("Thinking…");
    this.entry.value = "";
    const prior = this.plugin.getActiveMessages().slice();
    const chatId = this.plugin.settings.activeChatId;
    const user: Message = { role: "user", content: text };
    this.appendMessage(user);
    const output = this.appendMessage({ role: "assistant", content: "Connecting…" }, true);
    try {
      const response = await this.plugin.answer(prior, text, this.includeNote.checked, this.useTools.checked, partial => {
        output.setText(partial || "Waiting for response…");
        this.transcript.scrollTop = this.transcript.scrollHeight;
      }, status => {
        // Status updates are only placeholders, never appended to chat history.
        output.setText(status);
      });
      output.empty();
      await MarkdownRenderer.render(this.app, response, output, "", this);
      await this.plugin.addHistory(chatId, user, { role: "assistant", content: response });
    } catch (error) {
      output.setText("Request failed: " + String(error));
      output.addClass("mabel-mobile-error");
    } finally {
      this.busy = false;
      this.submit.disabled = false;
      this.submit.setText("Send");
    }
  }
}

class MobileHistoryModal extends Modal {
  constructor(app: MabelMobilePlugin["app"], private readonly plugin: MabelMobilePlugin) {
    super(app);
  }

  onOpen(): void {
    this.contentEl.empty();
    new Setting(this.contentEl).setName("Previous conversations").setHeading();
    const chats = [...this.plugin.settings.chats]
      .filter(chat => chat.messages.length)
      .sort((a, b) => b.updatedAt - a.updatedAt);
    if (!chats.length) {
      this.contentEl.createDiv({ text: "No previous conversations yet." });
      return;
    }
    for (const chat of chats) {
      const selected = chat.id === this.plugin.settings.activeChatId;
      new Setting(this.contentEl)
        .setName(chat.title)
        .setDesc(new Date(chat.updatedAt).toLocaleString() + (selected ? " · Current chat" : ""))
        .addButton(button => button
          .setButtonText(selected ? "Current" : "Open")
          .setDisabled(selected)
          .onClick(() => {
            void this.plugin.selectChat(chat.id).then(() => this.close());
          }));
    }
  }
}

class MobileSettingsTab extends PluginSettingTab {
  constructor(app: MabelMobilePlugin["app"], private readonly plugin: MabelMobilePlugin) { super(app, plugin); }

  display(): void {
    const root = this.containerEl;
    root.empty();
    new Setting(root).setName(TITLE).setHeading();
    root.createEl("p", { text: REMOTE_HINT });
    new Setting(root).setName("Ollama URL")
      .setDesc("Example: https://desktop.tailnet.ts.net (without /api/chat)")
      .addText(input => {
        input.setPlaceholder("Server address").setValue(this.plugin.settings.baseUrl)
          .onChange(async value => { this.plugin.settings.baseUrl = value.trim().replace(/\/+$/, ""); await this.plugin.saveSettings(); });
        input.inputEl.addClass("mabel-mobile-wide");
      });
    new Setting(root).setName("Model")
      .addText(input => input.setValue(this.plugin.settings.model)
        .onChange(async value => { this.plugin.settings.model = value.trim(); await this.plugin.saveSettings(); }))
      .addButton(btn => btn.setButtonText("Check models").onClick(async () => {
        try {
          const names = await this.plugin.listModels();
          new Notice(names.length ? names.join(", ") : "No Ollama models returned.");
        } catch (error) { new Notice("Could not list models: " + String(error)); }
      }));
    new Setting(root).setName("Thinking mode")
      .addDropdown(dropdown => dropdown.addOption("default", "Model default").addOption("off", "Off").addOption("on", "On")
        .setValue(this.plugin.settings.thinking)
        .onChange(async value => { this.plugin.settings.thinking = value as Thinking; await this.plugin.saveSettings(); }));
    const avatarPreview = root.createDiv({ cls: "mabel-mobile-avatar-preview" });
    const showAvatar = () => {
      avatarPreview.empty();
      if (this.plugin.settings.avatar) avatarPreview.createEl("img", { attr: { src: this.plugin.settings.avatar, alt: "Assistant avatar preview" } });
      else avatarPreview.createSpan({ text: "No local avatar chosen" });
    };
    showAvatar();
    const avatarPicker = root.createEl("input", { type: "file" });
    avatarPicker.hidden = true;
    avatarPicker.accept = "image/png,image/jpeg,image/webp,image/gif";
    avatarPicker.addEventListener("change", () => {
      const selected = avatarPicker.files?.[0];
      if (!selected) return;
      void readAvatarImage(selected).then(async avatar => {
        this.plugin.settings.avatar = avatar;
        await this.plugin.saveSettings();
        showAvatar();
        await this.plugin.refreshChatAvatar();
      }).catch(error => { new Notice(String(error)); }).finally(() => { avatarPicker.value = ""; });
    });
    new Setting(root).setName("Assistant profile picture")
      .setDesc("Upload a picture to show beside assistant messages.")
      .addButton(btn => btn.setButtonText("Choose image").onClick(() => avatarPicker.click()))
      .addButton(btn => btn.setButtonText("Clear image").onClick(() => {
        void (async () => {
          delete this.plugin.settings.avatar;
          await this.plugin.saveSettings();
          showAvatar();
          await this.plugin.refreshChatAvatar();
        })();
      }));
    new Setting(root).setName("Reuse desktop avatar")
      .setDesc("Prefer the desktop avatar when its plugin settings are synced.")
      .addToggle(toggle => toggle.setValue(this.plugin.settings.reuseDesktopAvatar)
        .onChange(async value => {
          this.plugin.settings.reuseDesktopAvatar = value;
          await this.plugin.saveSettings();
          await this.plugin.refreshChatAvatar();
        }));
    new Setting(root).setName("Allow vault tools")
      .setDesc("Read-only note search, listing, and reading, enabled only when requested in the chat.")
      .addToggle(toggle => toggle.setValue(this.plugin.settings.allowVaultTools)
        .onChange(async value => { this.plugin.settings.allowVaultTools = value; await this.plugin.saveSettings(); }));
    new Setting(root).setName("Allow web search")
      .setDesc("Experimental DuckDuckGo search. Queries are sent to DuckDuckGo only when chat tools are enabled.")
      .addToggle(toggle => toggle.setValue(this.plugin.settings.allowWebSearch)
        .onChange(async value => { this.plugin.settings.allowWebSearch = value; await this.plugin.saveSettings(); }));
    new Setting(root).setName("Reuse desktop persona")
      .setDesc("Read the system prompt from the desktop Local LLM Hub settings if that file is synced to this vault.")
      .addToggle(toggle => toggle.setValue(this.plugin.settings.reuseDesktopPrompt)
        .onChange(async value => { this.plugin.settings.reuseDesktopPrompt = value; await this.plugin.saveSettings(); }));
    new Setting(root).setName("Fallback system prompt")
      .setDesc("Used if desktop settings are unavailable.")
      .addTextArea(input => {
        input.setValue(this.plugin.settings.systemPrompt)
          .onChange(async value => { this.plugin.settings.systemPrompt = value; await this.plugin.saveSettings(); });
        input.inputEl.addClass("mabel-mobile-prompt");
      });
  }
}

export default class MabelMobilePlugin extends Plugin {
  settings: MobileSettings = { ...defaults };
  private lastNotePath: string | null = null;

  async onload(): Promise<void> {
    const stored = await this.loadData() as (Partial<MobileSettings> & { history?: Message[] }) | null;
    const migration = migrateChatState(stored ?? {});
    this.settings = { ...defaults, ...stored, chats: migration.chats, activeChatId: migration.activeChatId };
    // The legacy single transcript has been imported into the first conversation.
    delete (this.settings as Partial<MobileSettings> & { history?: Message[] }).history;
    if (migration.migrated) await this.saveSettings();
    this.registerView(VIEW, leaf => new MobileChat(leaf, this));
    this.addRibbonIcon("bot", OPEN_LABEL, () => { void this.openChat(); });
    this.addCommand({ id: "open-chat", name: OPEN_LABEL, callback: () => { void this.openChat(); } });
    this.addSettingTab(new MobileSettingsTab(this.app, this));
  }

  async openChat(): Promise<void> {
    const activeFile = this.app.workspace.getActiveFile();
    if (activeFile?.extension === "md") this.lastNotePath = activeFile.path;
    let leaf = this.app.workspace.getLeavesOfType(VIEW)[0];
    if (!leaf) {
      leaf = this.app.workspace.getLeaf(true);
      await leaf.setViewState({ type: VIEW, active: true });
    }
    await this.app.workspace.revealLeaf(leaf);
  }

  async saveSettings(): Promise<void> { await this.saveData(this.settings); }

  getActiveMessages(): Message[] {
    return this.settings.chats.find(chat => chat.id === this.settings.activeChatId)?.messages ?? [];
  }

  private chatBusy(): boolean {
    return this.app.workspace.getLeavesOfType(VIEW).some(leaf =>
      leaf.view instanceof MobileChat && leaf.view.isBusy());
  }

  private refreshChat(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW)) {
      if (leaf.view instanceof MobileChat) leaf.view.refreshConversation();
    }
  }

  async startNewChat(): Promise<void> {
    if (this.chatBusy()) return;
    const chat = newConversation();
    this.settings.chats = [chat, ...this.settings.chats].slice(0, 50);
    this.settings.activeChatId = chat.id;
    await this.saveSettings();
    this.refreshChat();
  }

  async selectChat(id: string): Promise<void> {
    if (this.chatBusy() || !this.settings.chats.some(chat => chat.id === id)) return;
    this.settings.activeChatId = id;
    await this.saveSettings();
    this.refreshChat();
  }

  async addHistory(chatId: string, user: Message, assistant: Message): Promise<void> {
    this.settings.chats = appendConversation(this.settings.chats, chatId, user, assistant);
    await this.saveSettings();
  }

  private async desktopSettings(): Promise<{ systemPrompt?: string; assistantAvatar?: string } | undefined> {
    try {
      const path = this.app.vault.configDir + "/plugins/local-llm-hub/data.json";
      if (!await this.app.vault.adapter.exists(path)) return undefined;
      const data: unknown = JSON.parse(await this.app.vault.adapter.read(path));
      if (data && typeof data === "object") return data as { systemPrompt?: string; assistantAvatar?: string };
    } catch { /* Settings may not be synced to the phone. */ }
    return undefined;
  }

  async resolveAvatar(): Promise<string | undefined> {
    if (this.settings.reuseDesktopAvatar) {
      const settings = await this.desktopSettings();
      if (settings?.assistantAvatar?.startsWith("data:image/")) return settings.assistantAvatar;
    }
    return this.settings.avatar;
  }

  async refreshChatAvatar(): Promise<void> {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW)) {
      if (leaf.view instanceof MobileChat) await leaf.view.refreshAvatar();
    }
  }

  async listModels(): Promise<string[]> {
    if (!this.settings.baseUrl) throw new Error("Configure the Ollama URL first.");
    const response = await requestUrl({ url: this.settings.baseUrl + "/api/tags", method: "GET" });
    const json = response.json as { models?: Array<{ name?: string }> };
    return json.models?.map(model => model.name).filter((name): name is string => !!name) ?? [];
  }

  async answer(
    prior: Message[], question: string, includeActiveNote: boolean,
    enableTools: boolean, onText: (text: string) => void, onStatus: (status: string) => void,
  ): Promise<string> {
    const systemPrompt = (this.settings.reuseDesktopPrompt ? (await this.desktopSettings())?.systemPrompt : undefined) || this.settings.systemPrompt;
    let userContent = question;
    if (includeActiveNote) {
      const path = this.lastNotePath;
      const file = path ? this.app.vault.getAbstractFileByPath(path) : null;
      if (!(file instanceof TFile) || file.extension !== "md") {
        throw new Error("Open a Markdown note before launching Mabel to include its contents.");
      }
      const noteText = await this.app.vault.cachedRead(file);
      userContent += "\n\n[Obsidian note: " + file.path + "]\n" + noteText.slice(0, 12000);
      if (noteText.length > 12000) userContent += "\n[Note truncated]";
    }

    type WireMessage = {
      role: "system" | "user" | "assistant" | "tool";
      content: string;
      tool_name?: string;
      tool_calls?: FunctionCall[];
    };
    const messages: WireMessage[] = [];
    if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
    messages.push(...prior);
    messages.push({ role: "user", content: userContent });
    const payload: { model: string; messages: WireMessage[]; think?: boolean } = {
      model: this.settings.model, messages,
    };
    if (this.settings.thinking !== "default") payload.think = this.settings.thinking === "on";

    // Mobile tools are intentionally opt-in, local, and read-only.
    const definitions = enableTools
      ? mobileToolDefinitions(this.settings.allowVaultTools, this.settings.allowWebSearch)
      : [];
    if (definitions.length) {
      onStatus("Checking available tools…");
      for (let round = 0; round < 3; round++) {
        const response = await requestUrl({
          url: this.settings.baseUrl + "/api/chat",
          method: "POST", contentType: "application/json",
          body: JSON.stringify({ ...payload, tools: definitions, stream: false }),
        });
        const json = response.json as { message?: { content?: string; tool_calls?: FunctionCall[] } };
        const result = json.message;
        if (!result) throw new Error("Ollama returned no message.");
        const calls = result.tool_calls?.slice(0, 4) ?? [];
        if (!calls.length) {
          if (!result.content?.trim()) throw new Error("Ollama returned an empty reply.");
          onText(result.content);
          return result.content;
        }
        messages.push({ role: "assistant", content: result.content ?? "", tool_calls: calls });
        for (const call of calls) {
          const name = call.function?.name ?? "";
          const args = call.function?.arguments;
          const argumentsObject = args && typeof args === "object" ? args : {};
          const output = await executeMobileTool(
            this.app, name, argumentsObject, this.settings.allowVaultTools, this.settings.allowWebSearch,
          );
          messages.push({ role: "tool", tool_name: name, content: output.slice(0, 15000) });
        }
        onStatus("Reading tool results…");
      }
      // Prevent infinite tool recursion. Final response may use the results.
    }
    return streamOllama(this.settings.baseUrl, payload, onText, onStatus);
  }
}
