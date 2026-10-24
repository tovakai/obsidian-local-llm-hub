# Mabel Mobile v0.2.0: experimental Android-first companion

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
- Uses local conversation history (last 60 messages), stored in this
  companion's own Obsidian plugin data.
- Can reuse the desktop Local LLM Hub system prompt if
  `.obsidian/plugins/local-llm-hub/data.json` is available within the
  phone's vault. Otherwise set the fallback system prompt manually.
- Supports Default / Off / On via Ollama's native `think` parameter.
- Optional **Include active note** adds up to 12,000 characters from the Markdown note active when the chat was opened. Note text is not saved in the mobile chat transcript.
- **v0.2.0:** avatar upload with optional desktop-avatar inheritance, mobile safe-area fixes,
  opt-in read-only note tools and experimental DuckDuckGo web search.
- **Streaming:** first attempts browser fetch for progressive NDJSON. If Android's
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
