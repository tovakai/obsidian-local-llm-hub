import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolDefinition } from "../types";
import type { LocalLlmHubPlugin } from "../plugin";
import type { ScheduledTask } from "./scheduler";

const mock = vi.hoisted(() => ({
  stream: vi.fn(),
  execute: vi.fn(),
  getVaultTools: vi.fn(),
}));

vi.mock("./localLlmProvider", () => ({ localLlmChatStream: mock.stream }));
vi.mock("./toolExecutor", () => ({ executeToolCall: mock.execute }));
vi.mock("./tools", () => ({ getVaultTools: mock.getVaultTools }));

import { runScheduledAgent, scheduledTools, type ScheduledToolAudit } from "./scheduledAgent";

const definition = (name: string): ToolDefinition => ({
  type: "function",
  function: { name, description: name, parameters: { type: "object", properties: {} } },
});

const task: ScheduledTask = {
  id: "one", title: "Vault cleanup", prompt: "Create an index note.",
  kind: "prompt", repeat: "daily", intervalMinutes: 60,
  startsAt: Date.now(), nextRunAt: Date.now(), enabled: true, createdAt: Date.now(),
};

function host() {
  const getAllTools = vi.fn().mockReturnValue([definition("mcp__shell__run_command")]);
  const plugin = {
    app: { vault: {} },
    settings: {
      llmConfig: { framework: "ollama", baseUrl: "http://localhost:11434", model: "test" },
      systemPrompt: "",
      vaultToolAllowedFolders: ["Mabel"],
      mcpServers: [{ id: "shell", name: "Shell", enabled: true },
        { id: "off", name: "Off", enabled: true }],
      mcpServerEnabled: { off: false },
    },
    mcpManager: { getAllTools },
  } as unknown as LocalLlmHubPlugin;
  return { plugin, getAllTools };
}

beforeEach(() => {
  mock.stream.mockReset();
  mock.execute.mockReset().mockResolvedValue({ success: true, result: "Created: Mabel/index.md" });
  mock.getVaultTools.mockReset().mockReturnValue([
    definition("read_note"), definition("create_note"), definition("delete_note"), definition("propose_schedule"),
  ]);
});

describe("scheduled agent permissions", () => {
  it("defaults to no tools, even when capable MCP integrations are connected", () => {
    const { plugin, getAllTools } = host();
    expect(scheduledTools(task, plugin)).toEqual([]);
    expect(getAllTools).not.toHaveBeenCalled();
  });

  it("grants vault tools but excludes schedule creation when only the first switch is on", () => {
    const { plugin, getAllTools } = host();
    const names = scheduledTools({ ...task, allowTools: true }, plugin).map(x => x.function.name);
    expect(names).toContain("create_note");
    expect(names).toContain("delete_note");
    expect(names).toContain("execute_javascript");
    expect(names).not.toContain("propose_schedule");
    expect(names).not.toContain("mcp__shell__run_command");
    expect(getAllTools).not.toHaveBeenCalled();
  });

  it("only exposes tools from connected MCP integrations allowed by user settings", () => {
    const { plugin, getAllTools } = host();
    const names = scheduledTools({ ...task, allowTools: true, allowMcpTools: true }, plugin).map(x => x.function.name);
    expect(names).toContain("mcp__shell__run_command");
    expect(getAllTools).toHaveBeenCalledWith(["shell"]);
  });

  it("actually executes a permitted vault tool and passes the result back to the model", async () => {
    const { plugin } = host();
    mock.stream
      .mockImplementationOnce(async function* () {
        yield { type: "tool_call", toolCall: { id: "call-1", name: "create_note", args: { path: "Mabel/index.md", content: "Hello" } } };
        yield { type: "done", content: "" };
      })
      .mockImplementationOnce(async function* () {
        yield { type: "text", content: "I created the index note." };
        yield { type: "done", content: "" };
      });
    const audit: ScheduledToolAudit[] = [];
    const result = await runScheduledAgent({ ...task, allowTools: true }, plugin, new AbortController().signal, audit);
    expect(result).toContain("I created the index note.");
    expect(mock.execute).toHaveBeenCalledOnce();
    expect(mock.execute.mock.calls[0][1]).toMatchObject({
      vaultToolMode: "all",
      vaultToolAllowedFolders: ["Mabel"],
    });
    expect(audit).toEqual([expect.objectContaining({ name: "create_note", success: true, target: "Mabel/index.md" })]);
    expect(mock.stream.mock.calls[1][1]).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: "tool", toolName: "create_note", content: "Created: Mabel/index.md" }),
    ]));
  });

  it("blocks a hallucinated tool call without a persisted opt-in", async () => {
    const { plugin } = host();
    mock.stream
      .mockImplementationOnce(async function* () {
        yield { type: "tool_call", toolCall: { id: "call-1", name: "delete_note", args: { path: "Mabel/index.md" } } };
        yield { type: "done", content: "" };
      })
      .mockImplementationOnce(async function* () {
        yield { type: "text", content: "The action was blocked." };
        yield { type: "done", content: "" };
      });
    const audit: ScheduledToolAudit[] = [];
    await runScheduledAgent({ ...task, allowTools: false, allowMcpTools: true }, plugin, new AbortController().signal, audit);
    expect(mock.execute).not.toHaveBeenCalled();
    expect(audit[0]).toMatchObject({ name: "delete_note", success: false });
  });

  it("only skips interactive MCP approval when the user enables both switches", async () => {
    const { plugin } = host();
    mock.stream
      .mockImplementationOnce(async function* () {
        yield { type: "tool_call", toolCall: { id: "call-1", name: "mcp__shell__run_command", args: { command: "pwd" } } };
        yield { type: "done", content: "" };
      })
      .mockImplementationOnce(async function* () {
        yield { type: "text", content: "Executed the command." };
        yield { type: "done", content: "" };
      });
    const audit: ScheduledToolAudit[] = [];
    await runScheduledAgent({ ...task, allowTools: true, allowMcpTools: true }, plugin, new AbortController().signal, audit);
    expect(mock.execute.mock.calls[0][1]).toMatchObject({ skipMcpApproval: true, mcpManager: plugin.mcpManager });
  });
});
