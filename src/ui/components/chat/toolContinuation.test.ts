import { afterEach, describe, expect, it, vi } from "vitest";
import { retryToolRound } from "./toolContinuation";

const empty = { toolCalls: [], incompleteToolCall: false, emptyText: true, finishReason: "stop" };

afterEach(() => vi.restoreAllMocks());

describe("tool continuation retries", () => {
  it("fails once with actionable guidance when thinking uses the output budget", async () => {
    const stream = vi.fn().mockResolvedValue({ ...empty, finishReason: "length" });
    // Applies on both the first round and after a tool result.
    await expect(retryToolRound(stream)).rejects.toThrow("Increase Max tokens");
    expect(stream).toHaveBeenCalledTimes(1);
    stream.mockClear();
    await expect(retryToolRound(stream, true)).rejects.toThrow("output token limit");
    expect(stream).toHaveBeenCalledTimes(1);
  });

  it("recovers from an empty continuation without executing the tool again", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const nextCall = { id: "call2", name: "next_tool", args: {} };
    const stream = vi.fn().mockResolvedValueOnce(empty).mockResolvedValueOnce({ ...empty, toolCalls: [nextCall] });
    expect(await retryToolRound(stream, true)).toEqual([nextCall]);
    expect(stream).toHaveBeenCalledTimes(2);
  });

  it("limits empty continuations to three attempts and logs the actual reason", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const stream = vi.fn().mockResolvedValue(empty);
    await expect(retryToolRound(stream, true)).rejects.toThrow("repeatedly returned an incomplete response");
    expect(stream).toHaveBeenCalledTimes(3);
    expect(warn.mock.calls[2][1]).toMatchObject({ finishReason: "stop", emptyText: true, retrying: false });
  });

  it("keeps incomplete OpenAI tool-call recovery", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const stream = vi.fn().mockResolvedValueOnce({ ...empty, incompleteToolCall: true, finishReason: undefined })
      .mockResolvedValueOnce({ ...empty, emptyText: false });
    expect(await retryToolRound(stream)).toEqual([]);
    expect(stream).toHaveBeenCalledTimes(2);
  });

  it("accepts a nonempty answer even when it reaches the output limit", async () => {
    const stream = vi.fn().mockResolvedValue({ ...empty, emptyText: false, finishReason: "length" });
    expect(await retryToolRound(stream, true)).toEqual([]);
    expect(stream).toHaveBeenCalledTimes(1);
  });

  it("does not retry or show a failure when cancelled during a round", async () => {
    const abort = new AbortController();
    const stream = vi.fn().mockImplementation(() => { abort.abort(); return Promise.resolve(empty); });
    expect(await retryToolRound(stream, true, abort.signal)).toEqual([]);
    expect(stream).toHaveBeenCalledTimes(1);
  });
});
