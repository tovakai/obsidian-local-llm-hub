/**
 * Tool-capable agent loop for explicitly authorized scheduled AI tasks.
 * Permission is enforced here, not merely in the system prompt.
 * Scheduled runs cannot ask the user for interactive approval, so enabling
 * the switches grants unattended access to the selected tool categories.
 */
import type { LocalLlmHubPlugin } from "../plugin";
import type { ScheduledTask } from "./scheduler";
import type { ActivityKind } from "./activityLog";
import type { Message, ToolDefinition } from "../types";
import { accumulateStreamChunk, createStreamAccumulation } from "obsidian-llm-hub-common/chat";
import { localLlmChatStream } from "./localLlmProvider";
import { executeToolCall } from "./toolExecutor";
import { getVaultTools } from "./tools";
import { EXECUTE_JAVASCRIPT_TOOL } from "./sandboxExecutor";

const MAX_TOOL_ROUNDS = 8;
const MAX_TOTAL_CALLS = 24;
const MAX_TOOL_RESULT_CHARS = 12_000;

export interface ScheduledToolAudit {
  name: string;
  success: boolean;
  /** Target path, when one was provided; no secrets or full arguments in the log. */
  target?: string;
  detail: string;
}

function limitedText(result: string): string {
  if (result.length <= MAX_TOOL_RESULT_CHARS) return result;
  return result.slice(0, MAX_TOOL_RESULT_CHARS) + "\n[Tool result truncated to protect model context]";
}

function targetOf(args: Record<string, unknown>): string | undefined {
  for (const key of ["path", "oldPath", "newPath", "folder"]) {
    if (typeof args[key] === "string" && args[key]) return args[key].slice(0, 180);
  }
  return undefined;
}

export function scheduledTools(
  task: Pick<ScheduledTask, "kind" | "allowTools" | "allowMcpTools">,
  plugin: LocalLlmHubPlugin,
): ToolDefinition[] {
  if (task.kind !== "prompt" || task.allowTools !== true) return [];

  // Scheduling itself is deliberately excluded to prevent a recurring task
  // from creating new autonomous tasks without user approval.
  const vault = getVaultTools("all").filter(tool => tool.function.name !== "propose_schedule");
  const connected = task.allowMcpTools === true
    ? plugin.mcpManager.getAllTools(
      (plugin.settings.mcpServers ?? [])
        .filter(server => server.enabled && plugin.settings.mcpServerEnabled?.[server.id ?? server.name] !== false)
        .map(server => server.id ?? server.name),
    )
    : [];

  return [...vault, EXECUTE_JAVASCRIPT_TOOL, ...connected];
}

/**
 * Tool calls execute only when the schedule has the relevant persisted opt-in,
 * AND the tool is in the per-run list of explicitly enabled capabilities.
 */
export async function runScheduledAgent(
  task: ScheduledTask,
  plugin: LocalLlmHubPlugin,
  signal: AbortSignal,
  audit: ScheduledToolAudit[],
  onActivity?: (kind: ActivityKind, title: string, path?: string) => void,
): Promise<string> {
  const config = { ...plugin.settings.llmConfig };
  if (!config.model) throw new Error("Configure Mabel's local model before running AI tasks.");

  const tools = scheduledTools(task, plugin);
  if (tools.length > 0 && config.framework === "anythingllm") {
    throw new Error("This LLM server does not support tool calling. Disable tools for this schedule or choose a supported model.");
  }

  const enabledTools = new Set(tools.map(tool => tool.function.name));
  const toolPolicy = task.allowTools === true
    ? [
        "This user explicitly authorized unattended tool use for this scheduled task.",
        "You may call the offered tools to complete the instruction; existing vault edits, renames and deletions are permitted within the configured vault folder scope.",
        task.allowMcpTools === true
          ? "Connected MCP tools are permitted, including potentially command-executing tools. Use only tools offered in this request."
          : "External MCP tools are disabled for this task.",
        "Do not attempt to create, modify, or enable schedules.",
      ].join(" ")
    : "This scheduled task is text-only. Do not call tools or claim to have changed files.";

  const systemPrompt = [
    "You are Mabel, a local AI assistant integrated with an Obsidian vault.",
    plugin.settings.systemPrompt,
    "Complete the following scheduled user instruction. Today, locally, is " + new Date().toString() + ".",
    toolPolicy,
    "Never claim an action succeeded when its tool call failed.",
    "Finish with a concise account of what you actually accomplished.",
  ].filter(Boolean).join("\n\n");

  const messages: Message[] = [
    { role: "user", content: task.prompt, timestamp: Date.now() },
  ];
  const transcript: string[] = [];
  let totalCalls = 0;

  for (let roundIndex = 0; roundIndex <= MAX_TOOL_ROUNDS; roundIndex++) {
    if (signal.aborted) throw new Error("Scheduled run cancelled.");
    const round = createStreamAccumulation();
    for await (const chunk of localLlmChatStream(
      config, messages, systemPrompt, signal, tools.length > 0 ? tools : undefined,
    )) {
      if (signal.aborted) throw new Error("Scheduled run cancelled.");
      if (chunk.type === "error") throw new Error(chunk.error || chunk.content || "Local model failed.");
      accumulateStreamChunk(round, chunk);
    }

    if (round.text.trim()) transcript.push(round.text.trim());
    if (round.incompleteToolCall) throw new Error("The model returned an incomplete tool call; no additional tools were executed.");

    const calls = round.toolCalls;
    if (!calls.length) {
      if (!transcript.length && !audit.length) throw new Error("The local model returned no response.");
      return transcript.join("\n\n").trim() || "The tools completed; no further text was generated.";
    }

    if (roundIndex === MAX_TOOL_ROUNDS) {
      throw new Error("Scheduled agent reached its maximum tool rounds (8); review the task or split it into smaller jobs.");
    }

    messages.push({
      role: "assistant",
      content: round.text,
      timestamp: Date.now(),
      toolCalls: calls,
    });

    for (const call of calls) {
      if (signal.aborted) throw new Error("Scheduled run cancelled.");
      totalCalls++;
      if (totalCalls > MAX_TOTAL_CALLS) {
        throw new Error("Scheduled agent exceeded 24 tool calls; execution stopped.");
      }

      onActivity?.("tool-start", call.name, targetOf(call.args));
      let success = false;
      let resultText: string;
      let attachments: Message["attachments"];

      if (!enabledTools.has(call.name)) {
        // This is a real authorization check. Hallucinating a tool call
        // cannot bypass a switch by reaching the executor directly.
        resultText = "Tool blocked: not enabled for this scheduled task.";
      } else {
        try {
          const result = await executeToolCall(call, {
            app: plugin.app,
            vaultToolAllowedFolders: plugin.settings.vaultToolAllowedFolders,
            vaultToolMode: "all",
            pdfInputMode: "extract-text",
            mcpManager: task.allowMcpTools === true ? plugin.mcpManager : undefined,
            skipMcpApproval: task.allowMcpTools === true,
            // No interactive proposal callback: the user expressly granted
            // unattended vault changes by enabling this task's tool switch.
          });
          success = result.success;
          resultText = result.result;
          attachments = result.attachments;
        } catch (error) {
          resultText = error instanceof Error ? error.message : String(error);
        }
      }

      onActivity?.(success ? "tool-success" : "tool-error", call.name, targetOf(call.args));
      audit.push({
        name: call.name,
        success,
        target: targetOf(call.args),
        detail: success ? "Completed" : limitedText(resultText).slice(0, 350),
      });
      messages.push({
        role: "tool",
        content: limitedText(resultText),
        timestamp: Date.now(),
        toolCallId: call.id,
        toolName: call.name,
        attachments,
      });
    }
  }

  throw new Error("Scheduled agent stopped without a final response.");
}
