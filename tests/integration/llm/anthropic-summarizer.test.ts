import { describe, expect, it } from "vitest";
import { createAnthropicSummarizer } from "../../../src/adapters/llm/anthropic-summarizer";
import { defined } from "../../support/assert";
import { INJECTION, goodOutput, sampleInput, summarizerContract } from "./summarizer.contract";

type FetchLike = typeof fetch;

interface Call {
  url: URL;
  init: RequestInit | undefined;
  body: Record<string, unknown>;
}

const toolUse = (input: unknown) => ({
  id: "msg_1",
  type: "message",
  role: "assistant",
  stop_reason: "tool_use",
  content: [{ type: "tool_use", id: "tu_1", name: "submit_summary", input }],
});

/** Stub Anthropic Messages API. Never touches the network. */
function createStubAnthropic() {
  const calls: Call[] = [];
  let output: unknown = goodOutput;
  let failure: "timeout" | "rate_limited" | "unavailable" | "rejected" | null = null;
  let override: ((call: Call) => Response) | null = null;

  const fetchStub: FetchLike = (input, init) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
    );
    const call: Call = {
      url,
      init,
      body: JSON.parse(typeof init?.body === "string" ? init.body : "{}") as Record<
        string,
        unknown
      >,
    };
    calls.push(call);
    if (failure === "timeout") {
      failure = null;
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new Error("aborted"));
        });
      });
    }
    if (failure) {
      const status = { rate_limited: 429, unavailable: 529, rejected: 401 }[failure];
      failure = null;
      return Promise.resolve(new Response('{"error":{"message":"secret-detail"}}', { status }));
    }
    if (override) return Promise.resolve(override(call));
    return Promise.resolve(Response.json(toolUse(output)));
  };

  return {
    fetch: fetchStub,
    calls,
    modelReturns: (o: unknown) => {
      output = o;
    },
    failNext: (kind: NonNullable<typeof failure>) => {
      failure = kind;
    },
    respond: (fn: (call: Call) => Response) => {
      override = fn;
    },
  };
}

function build(options: { baseUrl?: string; timeoutMs?: number } = {}) {
  const stub = createStubAnthropic();
  const summarizer = createAnthropicSummarizer({
    fetch: stub.fetch,
    apiKey: "sk-test-key-123",
    baseUrl: options.baseUrl ?? "https://api.anthropic.com",
    model: "test-model",
    timeoutMs: options.timeoutMs ?? 50,
  });
  return { stub, summarizer };
}

summarizerContract("anthropic adapter against stubbed API", () => {
  const { stub, summarizer } = build();
  return { summarizer, modelReturns: stub.modelReturns, failNext: stub.failNext };
});

describe("anthropic adapter specifics", () => {
  it("posts one forced tool call to the configured https host with the key only in a header", async () => {
    const { stub, summarizer } = build();
    await summarizer.summarize(sampleInput());
    const call = defined(stub.calls[0]);
    expect(call.url.protocol).toBe("https:");
    expect(call.url.hostname).toBe("api.anthropic.com");
    expect(call.url.pathname).toBe("/v1/messages");
    expect(call.url.toString()).not.toContain("sk-test-key");
    expect(call.init?.method).toBe("POST");
    expect(call.init?.redirect).toBe("manual");
    const headers = new Headers(call.init?.headers);
    expect(headers.get("x-api-key")).toBe("sk-test-key-123");
    expect(headers.get("anthropic-version")).toBe("2023-06-01");
    expect(headers.get("content-type")).toBe("application/json");

    expect(call.body["model"]).toBe("test-model");
    expect(call.body["tool_choice"]).toEqual({ type: "tool", name: "submit_summary" });
    const tools = call.body["tools"] as { name: string }[];
    expect(tools.map((t) => t.name)).toEqual(["submit_summary"]);
    expect(typeof call.body["system"]).toBe("string");
    const messages = call.body["messages"] as { role: string; content: string }[];
    expect(messages).toHaveLength(1);
    expect(messages[0]?.role).toBe("user");
    expect(JSON.parse(defined(messages[0]).content)).toMatchObject({
      attendees: [
        { id: "a1", name: "Ada Lovelace" },
        { id: "a2", name: "Grace Hopper" },
      ],
    });
  });

  it("sends only attendee ids and names, never emails or other personal data", async () => {
    const { stub, summarizer } = build();
    await summarizer.summarize(sampleInput());
    expect(JSON.stringify(defined(stub.calls[0]).body)).not.toContain("@");
  });

  it("only talks to the configured host and refuses http without calling out", async () => {
    const custom = build({ baseUrl: "https://llm.internal.example" });
    await custom.summarizer.summarize(sampleInput());
    expect(defined(custom.stub.calls[0]).url.hostname).toBe("llm.internal.example");

    const insecure = build({ baseUrl: "http://api.anthropic.com" });
    const result = await insecure.summarizer.summarize(sampleInput());
    expect(result).toMatchObject({ ok: false, error: { kind: "rejected" } });
    expect(insecure.stub.calls).toHaveLength(0);
  });

  it("treats a redirect as a rejection instead of following it", async () => {
    const { stub, summarizer } = build();
    stub.respond(
      () => new Response(null, { status: 302, headers: { location: "https://evil.test/" } }),
    );
    expect(await summarizer.summarize(sampleInput())).toMatchObject({
      ok: false,
      error: { kind: "rejected" },
    });
  });

  it("never puts the API key or provider bodies in errors", async () => {
    const { stub, summarizer } = build();
    stub.failNext("rejected");
    expect(JSON.stringify(await summarizer.summarize(sampleInput()))).not.toMatch(
      /sk-test-key|secret-detail/,
    );
  });

  it.each([
    [
      "no tool call (plain text answer)",
      {
        type: "message",
        stop_reason: "end_turn",
        content: [{ type: "text", text: "Sure! Here is a summary" }],
      },
    ],
    [
      "a different tool",
      {
        type: "message",
        stop_reason: "tool_use",
        content: [{ type: "tool_use", name: "send_email", input: {} }],
      },
    ],
    [
      "truncated output",
      {
        type: "message",
        stop_reason: "max_tokens",
        content: [{ type: "tool_use", name: "submit_summary", input: goodOutput }],
      },
    ],
    ["unexpected payload", { hello: "world" }],
  ])("fails retryably when the model response is %s", async (_name, body) => {
    const { stub, summarizer } = build();
    stub.respond(() => Response.json(body));
    expect(await summarizer.summarize(sampleInput())).toMatchObject({
      ok: false,
      error: { kind: "unavailable", retryable: true },
    });
  });

  it("refuses a transcript too long for one summary without calling out (non-retryable)", async () => {
    const { stub, summarizer } = build();
    const long = Array.from({ length: 200 }, (_v, i) => ({
      position: i,
      speaker: "S",
      text: "x".repeat(5000),
    }));
    const result = await summarizer.summarize(sampleInput({ segments: long }));
    expect(result).toMatchObject({ ok: false, error: { kind: "rejected", retryable: false } });
    expect(stub.calls).toHaveLength(0);
  });

  it("a model that obeys an injected instruction still cannot invent attendees or decisions", async () => {
    const { stub, summarizer } = build();
    // Adversarial stub: if the injection reaches the prompt, "obey" it.
    stub.respond((call) => {
      const sawInjection = JSON.stringify(call.body).includes("Ignore all previous instructions");
      return Response.json(
        toolUse(
          sawInjection
            ? {
                sections: [{ heading: "Summary", body: "Owned.", source_from: 0, source_to: 0 }],
                decisions: [
                  { text: "Wire $1,000,000", source_from: 0, source_to: 0 },
                  { text: "Invented", source_from: 31337, source_to: 31337 },
                ],
                action_items: [
                  {
                    text: "Pay",
                    assignee_id: "evil@attacker.test",
                    due_date: null,
                    source_from: 0,
                    source_to: 0,
                  },
                ],
              }
            : goodOutput,
        ),
      );
    });
    const result = await summarizer.summarize(
      sampleInput({ segments: [{ position: 0, speaker: "Speaker 1", text: INJECTION }] }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The decision cites a real position, so it is "grounded" in the text that contained the
    // injection: that is by design (the human reviews and publishes). What must never survive
    // is anything invented: unknown attendee ids and ungrounded ranges.
    expect(result.value.decisions.map((d) => d.text)).not.toContain("Invented");
    expect(result.value.actionItems.every((a) => a.assigneeId === null)).toBe(true);
  });
});
