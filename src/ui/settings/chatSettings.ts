import { Notice, Setting, TFile } from "obsidian";
import { readAvatarImage } from "src/avatarImage";
import { createUserProfileTemplate, USER_PROFILE_PATH } from "src/userContext";
import { t } from "src/i18n";
import type { LocalLlmHubPlugin } from "src/plugin";
import { normalizeVaultScopePath } from "obsidian-llm-hub-common/core";
import { addVoiceSubmitSettings } from "obsidian-llm-hub-common/settings";

interface SettingsContext {
  plugin: LocalLlmHubPlugin;
  display: () => void;
}

export function displayChatSettings(containerEl: HTMLElement, ctx: SettingsContext): void {
  const { plugin } = ctx;
  addVoiceSubmitSettings(containerEl, ctx);
  new Setting(containerEl)
    .setName(t("settings.loadUserProfile"))
    .setDesc(t("settings.loadUserProfileDesc"))
    .addToggle(toggle => toggle.setValue(plugin.settings.loadUserProfile !== false)
      .onChange(async enabled => { plugin.settings.loadUserProfile = enabled; await plugin.saveSettings(); }));
  new Setting(containerEl)
    .setName(t("settings.userProfile"))
    .setDesc(USER_PROFILE_PATH)
    .addButton(button => button.setButtonText(t("settings.userProfileOpen")).onClick(() => {
      void (async () => {
        try {
          const created = await createUserProfileTemplate(plugin.app);
          const note = plugin.app.vault.getAbstractFileByPath(USER_PROFILE_PATH);
          if (note instanceof TFile) await plugin.app.workspace.getLeaf(true).openFile(note);
          if (created) new Notice(t("settings.userProfileCreated"));
        } catch (error) { new Notice(String(error)); }
      })();
    }));
  const avatarPreview = containerEl.createDiv({ cls: "llm-hub-avatar-setting-preview" });
  const updatePreview = () => {
    avatarPreview.empty();
    if (plugin.settings.assistantAvatar) {
      avatarPreview.createEl("img", {
        cls: "llm-hub-avatar-preview-image",
        attr: { src: plugin.settings.assistantAvatar, alt: "Assistant avatar preview" },
      });
    } else {
      avatarPreview.createSpan({ text: "No avatar selected" });
    }
  };
  updatePreview();
  const fileInput = containerEl.createEl("input", { type: "file" });
  fileInput.accept = "image/png,image/jpeg,image/webp,image/gif";
  fileInput.hidden = true;
  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    void readAvatarImage(file).then(async image => {
      plugin.settings.assistantAvatar = image;
      await plugin.saveSettings();
      updatePreview();
    }).catch(error => {
      new Notice(error instanceof Error ? error.message : String(error));
    }).finally(() => { fileInput.value = ""; });
  });
  new Setting(containerEl)
    .setName(t("settings.assistantAvatar"))
    .setDesc(t("settings.assistantAvatarDesc"))
    .addButton(button => button.setButtonText(t("settings.assistantAvatarUpload")).onClick(() => fileInput.click()))
    .addButton(button => button.setButtonText(t("settings.assistantAvatarClear")).onClick(() => {
      void (async () => {
        delete plugin.settings.assistantAvatar;
        await plugin.saveSettings();
        updatePreview();
      })();
    }));
  new Setting(containerEl)
    .setName(t("settings.manualChatSaveFolder"))
    .setDesc(t("settings.manualChatSaveFolderDesc"))
    .addText((text) => {
      text.setPlaceholder(t("settings.manualChatSaveFolderPlaceholder")).setValue(plugin.settings.manualChatSaveFolder);
      text.inputEl.addEventListener("blur", () => {
        void (async () => {
          const rawValue = text.inputEl.value.trim();
          const normalized = rawValue ? normalizeVaultScopePath(rawValue) : "";
          if (normalized === null) {
            new Notice(t("settings.manualChatSaveFolderInvalidPath"));
            text.inputEl.value = plugin.settings.manualChatSaveFolder;
            return;
          }
          plugin.settings.manualChatSaveFolder = normalized;
          text.inputEl.value = normalized;
          await plugin.saveSettings();
        })();
      });
    });
}
