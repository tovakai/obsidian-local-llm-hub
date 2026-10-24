# Mabel Mobile v0.6.0: experimental Android-first companion

This prototype lives in the same **fork** but has its own Obsidian plugin ID,
`mabel-mobile`. It does **not** replace or modify Local LLM Hub on Windows/Linux.

## Install

1. Download the **mobile-build** artifact from the GitHub Actions build for this branch.
2. On your Android phone, make sure Obsidian can open your vault.
3. Extract the three files into `.obsidian/plugins/mabel-mobile/` inside the phone's vault:
   `main.js`, `manifest.json`, `styles.css`.
4. Enable **Mabel Mobile** under Obsidian Community Plugins.
5. Set the Ollama URL to your Tailscale Serve HTTPS URL (no `/api/chat`),
   then ensure Tailscale is connected on the phone.
6. Open the Mabel Mobile ribbon button or command.

## Desktop avatar

The desktop fork adds an **Assistant profile picture** setting in Local LLM Hub chat settings. Pick a PNG/JPG/WebP/GIF image. It is resized to a 192px square PNG and shown beside assistant messages, including streaming responses. Desktop and mobile image settings remain independent, but mobile can reuse the desktop image if the plugin data is synced.

## Features and limitations

- Uses Obsidian's `requestUrl` and Ollama `/api/chat` with `stream:false`.
  The answer appears once completed, without token-by-token streaming.
- Saves up to 50 selectable mobile conversations (up to 60 messages each) in
  the companion's own plugin data. **History** reopens previous chats;
  **New chat** preserves old conversations.
  Existing v0.2 single-chat history is migrated automatically.
- Can reuse the desktop Local LLM Hub system prompt if
  `.obsidian/plugins/local-llm-hub/data.json` is available within the
  phone's vault. Otherwise set the fallback system prompt manually.
- Supports Default / Off / On via Ollama's native `think` parameter.
- Optional **Include active note** adds up to 12,000 characters from the Markdown note active when the chat was opened. Note text is not saved in the mobile chat transcript.
- **v0.2.0:** avatar upload with optional desktop-avatar inheritance, mobile safe-area fixes,
  opt-in read-only note tools and experimental DuckDuckGo web search.
- **Streaming:** shows a connection status instead of the ambiguous "…" placeholder, then attempts browser fetch for progressive NDJSON. If Android's
  CORS policy blocks the request, falls back to reliable buffered Obsidian requestUrl.
  The Tailscale/Caddy proxy must allow the Android app origin for true streaming.
  Tool-enabled first rounds are buffered so Ollama can return tool calls.
- **Not yet included:** desktop MCP subprocess tools, RAG, attachments,
  shared desktop chat history, or workflows.
- Enable the checkbox **Allow tools for this message** to let Mabel query mobile
  read-only vault tools or search the web. Both can be disabled in plugin settings.
  Search is best-effort: automated DuckDuckGo requests may be blocked.
- Avatar image selection is in plugin settings. Mabel Mobile prefers the desktop
  avatar from synced settings if **Reuse desktop avatar** is enabled.
- This is a **proof of concept**, not a mobile port of the full plugin.
- Never expose an unauthenticated Ollama server via Tailscale Funnel or
  public port forwarding. Tailscale Serve stays private to your tailnet.

- The composer shows **Include active note** and **Allow read-only tools** above the text box; **Send** shares the input row.

## Shared user context

Desktop and Android read the same `Mabel/Memory/User.md` from the Obsidian
vault. Use the new **About the user → Create or open** settings button
to generate an empty template and populate it with *confirmed* facts.
Each client injects a bounded excerpt into its system prompt unless disabled.
With vault tools enabled, `get_user_context(topic)` can read bounded excerpts
from User.md, Preferences.md, and Projects.md. Desktop RAG remains independent.

## Ask-before-editing on Android

**Vault write permissions** defaults to **Read-only**. Select **Ask before
editing** to offer `create_note` and `update_note` to the assistant when
the per-message tool checkbox is enabled. Every operation shows the existing
and proposed full Markdown contents in an approval dialog.
Closing or rejecting does not write. Updates recheck existing content before
writing to avoid overwriting a concurrent synced edit. Hidden folders,
plugin config files, and non-Markdown files are not writable.
No delete, rename, or silent write tools are enabled.

## Model tiers and assistant name

Both plugins offer **Low / Medium / High** in the chat interface instead of
exposing raw model tags. Set the associated Ollama model in each plugin's settings.
Unassigned tiers retain the previously configured model as a fallback.
Mobile can optionally reuse the desktop tier assignments via synced plugin settings.
Desktop chat now displays the assistant name **Mabel**, keeping actual model names
in message metadata for diagnostics; mobile already used Mabel in bubbles.

## Thinking effort slider

Both desktop and mobile expose Off / Brief / Standard / Deep directly in chat,
independently of the Low / Medium / High model selector. Ollama /api/show
advertises named thinking levels on supported models, and the plugin sends
those exact levels when available. For models with only a boolean think switch,
Off uses think:false, Standard uses think:true, and Brief/Deep use think:true
with a soft system-prompt effort preference. This is not a hard reasoning-token
budget, does not alter num_predict, and cannot guarantee a specific think length.
Old Off/On preferences are migrated and preserved.
