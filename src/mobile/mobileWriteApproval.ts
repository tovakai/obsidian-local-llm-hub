import { App, Modal, Setting, TFile } from "obsidian";
import { validateMobileWrite, type WriteOperation, MAX_APPROVED_NOTE_CHARS } from "./mobileWriteSafety";

class NoteApprovalModal extends Modal {
  private resolveDecision: ((approved: boolean) => void) | undefined;
  private decided = false;
  constructor(app: App, private readonly mode: WriteOperation, private readonly path: string,
    private readonly original: string, private readonly proposed: string) { super(app); }

  onOpen(): void {
    const root = this.contentEl;
    root.empty();
    new Setting(root).setName("Review proposed note change").setHeading();
    root.createEl("p", { text: (this.mode === "create_note" ? "Create " : "Update ") + this.path });
    root.createEl("p", { text: "Mabel cannot change the vault unless you approve this exact content." });
    if (this.mode === "update_note") {
      root.createEl("strong", { text: "Current version" });
      root.createEl("pre", { cls: "mabel-mobile-edit-preview", text: this.original });
    }
    root.createEl("strong", { text: "Proposed version" });
    root.createEl("pre", { cls: "mabel-mobile-edit-preview", text: this.proposed });
    new Setting(root)
      .addButton(button => button.setButtonText("Reject").onClick(() => this.finish(false)))
      .addButton(button => button.setButtonText("Approve change").setCta().onClick(() => this.finish(true)));
  }

  private finish(approved: boolean): void {
    if (this.decided) return;
    this.decided = true;
    this.resolveDecision?.(approved);
    this.close();
  }

  onClose(): void {
    if (!this.decided) { this.decided = true; this.resolveDecision?.(false); }
    this.contentEl.empty();
  }

  openAndWait(): Promise<boolean> {
    return new Promise(resolve => {
      this.resolveDecision = resolve;
      this.open();
    });
  }
}

function stringArg(args: Record<string, unknown>, key: string): string | null {
  return typeof args[key] === "string" ? args[key] : null;
}

/** Every mutation requires an explicit Obsidian modal approval, even repeated tool calls. */
export async function approveMobileWrite(app: App, mode: WriteOperation, args: Record<string, unknown>): Promise<string> {
  const path = stringArg(args, "path");
  const content = stringArg(args, "content");
  if (path === null || content === null) return "Rejected: path and full Markdown content are required.";
  const safety = validateMobileWrite(path, content, app.vault.configDir);
  if (safety) return "Rejected: " + safety;
  const previousFile = app.vault.getAbstractFileByPath(path);
  if (mode === "create_note" && previousFile) return "Rejected: destination exists. Use update_note.";
  if (mode === "update_note" && (!(previousFile instanceof TFile) || previousFile.extension !== "md")) {
    return "Rejected: note does not exist.";
  }
  const previous = previousFile instanceof TFile ? await app.vault.read(previousFile) : "";
  if (previous.length > MAX_APPROVED_NOTE_CHARS) return "Rejected: existing note is too large for a full approval preview.";
  if (mode === "update_note" && previous === content) return "No changes necessary.";
  const approved = await new NoteApprovalModal(app, mode, path, previous, content).openAndWait();
  if (!approved) return "Rejected by user. Do not retry without a new user request.";

  // Revalidate between preview and write. Sync/other apps may edit a note while reviewing.
  const latest = app.vault.getAbstractFileByPath(path);
  if (mode === "create_note") {
    if (latest) return "Rejected: destination changed while approval dialog was open.";
    const folders = path.split("/").slice(0, -1);
    for (let i = 0; i < folders.length; i++) {
      const folder = folders.slice(0, i + 1).join("/");
      if (!app.vault.getAbstractFileByPath(folder)) await app.vault.createFolder(folder);
    }
    await app.vault.create(path, content);
    return "Approved and created " + path;
  }
  if (!(latest instanceof TFile) || latest.path !== previousFile?.path) return "Rejected: note changed during approval.";
  if (await app.vault.read(latest) !== previous) return "Rejected: note was edited during approval. Re-read before proposing again.";
  await app.vault.modify(latest, content);
  return "Approved and updated " + path;
}
