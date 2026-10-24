import { ItemView, MarkdownRenderer, Notice, Plugin, PluginSettingTab, Setting, TFile, WorkspaceLeaf, requestUrl } from "obsidian";
import { readAvatarImage } from "../avatarImage";

type Role = "user" | "assistant";
type Message = { role: Role; content: string };
type Thinking = "default" | "off" | "on";
type MobileSettings = { baseUrl: string; model: string; thinking: Thinking; systemPrompt: string; reuseDesktopPrompt: boolean; reuseDesktopAvatar: boolean; avatar?: string; history: Message[] };
const VIEW = "mabel-mobile-chat";
const TITLE = "Mabel Mobile";
const OPEN_LABEL = "Open Mabel Mobile";
const TALK_PLACEHOLDER = "Talk to Mabel…";
const CONFIG_NOTICE = "Configure the Ollama URL and model in Mabel Mobile settings.";
const REMOTE_HINT = "Use your private Tailscale Serve HTTPS address to reach Ollama on the desktop. Do not use Funnel.";
const defaults: MobileSettings = { baseUrl: "", model: "mabel-qwen-64k:latest", thinking: "off", systemPrompt: "", reuseDesktopPrompt: true, reuseDesktopAvatar: true, history: [] };

class MobileChat extends ItemView {
  private transcript!: HTMLElement;
  private entry!: HTMLTextAreaElement;
  private submit!: HTMLButtonElement;
  private includeNote!: HTMLInputElement;
  private avatar: string | undefined;
  private busy = false;

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
    header.createEl("button", { text: "New chat" }).addEventListener("click", () => {
      if (!this.busy) void this.plugin.clearHistory().then(() => this.renderMessages());
    });
    this.transcript = root.createDiv({ cls: "mabel-mobile-transcript" });
    this.avatar = await this.plugin.resolveAvatar();
    this.renderMessages();
    const composer = root.createDiv({ cls: "mabel-mobile-composer" });
    this.entry = composer.createEl("textarea", { attr: { rows: "3", placeholder: TALK_PLACEHOLDER, "aria-label": "Message" } });
    this.entry.addEventListener("keydown", event => {
      if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); void this.send(); }
    });
    const noteLabel = composer.createEl("label");
    this.includeNote = noteLabel.createEl("input", { type: "checkbox" });
    noteLabel.appendText(" Include active note (read only)");
    this.submit = composer.createEl("button", { text: "Send", cls: "mod-cta" });
    this.submit.addEventListener("click", () => { void this.send(); });
    await Promise.resolve();
  }

  private renderMessages(): void {
    this.transcript.empty();
    if (!this.plugin.settings.history.length) {
      this.transcript.createDiv({ cls: "mabel-mobile-empty", text: "Mabel's brain lives on your desktop. Connect through Tailscale to begin." });
    } else {
      this.plugin.settings.history.forEach(message => this.appendMessage(message));
    }
  }

  async refreshAvatar(): Promise<void> {
    this.avatar = await this.plugin.resolveAvatar();
    this.renderMessages();
  }

  private appendMessage(message: Message): void {
    this.transcript.querySelector(".mabel-mobile-empty")?.remove();
    const row = this.transcript.createDiv({ cls: "mabel-mobile-row mabel-mobile-row-" + message.role });
    if (message.role === "assistant") {
      if (this.avatar) row.createEl("img", { cls: "mabel-mobile-avatar", attr: { src: this.avatar, alt: "" } });
      else row.createDiv({ cls: "mabel-mobile-avatar mabel-mobile-avatar-fallback", text: "M" });
    }
    const bubble = row.createDiv({ cls: "mabel-mobile-bubble mabel-mobile-" + message.role });
    bubble.createDiv({ cls: "mabel-mobile-author", text: message.role === "user" ? "You" : "Mabel" });
    const content = bubble.createDiv();
    void MarkdownRenderer.render(this.app, message.content, content, "", this)
      .catch(() => content.setText(message.content));
    this.transcript.scrollTop = this.transcript.scrollHeight;
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
    const prior = this.plugin.settings.history.slice();
    const user: Message = { role: "user", content: text };
    this.appendMessage(user);
    try {
      const reply: Message = { role: "assistant", content: await this.plugin.answer(prior, text, this.includeNote.checked) };
      this.appendMessage(reply);
      await this.plugin.addHistory(user, reply);
    } catch (error) {
      this.transcript.createDiv({ cls: "mabel-mobile-error", text: "Request failed: " + String(error) });
    } finally {
      this.busy = false;
      this.submit.disabled = false;
      this.submit.setText("Send");
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
      .setDesc("Upload a picture to show beside Mabel's messages.")
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
    const stored = await this.loadData() as Partial<MobileSettings> | null;
    this.settings = { ...defaults, ...stored, history: Array.isArray(stored?.history) ? stored.history : [] };
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
  async clearHistory(): Promise<void> { this.settings.history = []; await this.saveSettings(); }
  async addHistory(user: Message, assistant: Message): Promise<void> {
    this.settings.history = [...this.settings.history, user, assistant].slice(-60);
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

  async answer(prior: Message[], question: string, includeActiveNote = false): Promise<string> {
    const systemPrompt = (this.settings.reuseDesktopPrompt ? (await this.desktopSettings())?.systemPrompt : undefined) || this.settings.systemPrompt;
    let userContent = question;
    if (includeActiveNote) {
      const path = this.lastNotePath;
      const file = path ? this.app.vault.getAbstractFileByPath(path) : null;
      if (!(file instanceof TFile) || file.extension !== "md") {
        throw new Error("Open a Markdown note before launching Mabel to include its contents.");
      }
      {
        const noteText = await this.app.vault.cachedRead(file);
        userContent += "\n\n[Obsidian note: " + file.path + "]\n" + noteText.slice(0, 12000);
        if (noteText.length > 12000) userContent += "\n[Note truncated]";
      }
    }
    const messages: Array<{ role: "system" | Role; content: string }> = [];
    if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
    messages.push(...prior, { role: "user", content: userContent });
    const payload: { model: string; messages: typeof messages; stream: boolean; think?: boolean } = {
      model: this.settings.model, messages, stream: false,
    };
    if (this.settings.thinking !== "default") payload.think = this.settings.thinking === "on";
    const response = await requestUrl({
      url: this.settings.baseUrl + "/api/chat",
      method: "POST",
      contentType: "application/json",
      body: JSON.stringify(payload),
    });
    const json = response.json as { message?: { content?: string } };
    if (!json.message?.content?.trim()) throw new Error("Ollama returned an empty response.");
    return json.message.content;
  }
}
