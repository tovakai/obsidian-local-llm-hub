# Mabel Mobile: experimental Android-first companion

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
- **Not yet included:** vault tools, MCP tools, RAG, attachments,
  shared desktop chat history, or workflows.
- This is a **proof of concept**, not a mobile port of the full plugin.
- Never expose an unauthenticated Ollama server via Tailscale Funnel or
  public port forwarding. Tailscale Serve stays private to your tailnet.
