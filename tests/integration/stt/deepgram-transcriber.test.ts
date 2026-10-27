import { describe, expect, it } from "vitest";
import { createDeepgramTranscriber } from "../../../src/adapters/stt/deepgram-transcriber";
import { defined } from "../../support/assert";
import { transcriberContract } from "./transcriber.contract";

type FetchLike = typeof fetch;

interface Call {
  url: URL;
  init: RequestInit | undefined;
}

interface Utterance {
  startMs: number;
  endMs: number;
  speaker: number | null;
  text: string;
}

/** Stub Deepgram prerecorded API. Never touches the network. */
function createStubDeepgram() {
  const calls: Call[] = [];
  let utterances: Utterance[] = [];
  let failure: "timeout" | "rate_limited" | "unavailable" | "rejected" | null = null;
  let override: (() => Response) | null = null;

  const fetchStub: FetchLike = (input, init) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
    );
    calls.push({ url, init });
    if (failure === "timeout") {
      failure = null;
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new Error("aborted"));
        });
      });
    }
    if (failure) {
      const status = { rate_limited: 429, unavailable: 503, rejected: 401 }[failure];
      failure = null;
      return Promise.resolve(new Response('{"err_msg":"secret-detail"}', { status }));
    }
    if (override) return Promise.resolve(override());
    return Promise.resolve(
      Response.json({
        metadata: { request_id: "r" },
        results: {
          utterances: utterances.map((u) => ({
            start: u.startMs / 1000,
            end: u.endMs / 1000,
            transcript: u.text,
            ...(u.speaker === null ? {} : { speaker: u.speaker }),
          })),
        },
      }),
    );
  };

  return {
    fetch: fetchStub,
    calls,
    respondWith: (u: Utterance[]) => {
      utterances = u;
    },
    failNext: (kind: NonNullable<typeof failure>) => {
      failure = kind;
    },
    respondRaw: (fn: () => Response) => {
      override = fn;
    },
  };
}

function build(options: { baseUrl?: string; timeoutMs?: number } = {}) {
  const stub = createStubDeepgram();
  const transcriber = createDeepgramTranscriber({
    fetch: stub.fetch,
    apiKey: "dg-test-key-123",
    baseUrl: options.baseUrl ?? "https://api.deepgram.com",
    timeoutMs: options.timeoutMs ?? 50,
  });
  return { stub, transcriber };
}

const audio = new Uint8Array([1, 2, 3, 4]);
const req = { chunkId: "chunk-1", audio, contentType: "audio/webm" };

transcriberContract("deepgram adapter against stubbed API", () => {
  const { stub, transcriber } = build();
  return { transcriber, respondWith: stub.respondWith, failNext: stub.failNext };
});

describe("deepgram adapter specifics", () => {
  it("posts the raw audio to the configured https host with the key in the Authorization header only", async () => {
    const { stub, transcriber } = build();
    await transcriber.transcribe({ ...req, contentType: "audio/webm;codecs=opus" });
    const call = defined(stub.calls[0]);
    expect(call.url.protocol).toBe("https:");
    expect(call.url.hostname).toBe("api.deepgram.com");
    expect(call.url.pathname).toBe("/v1/listen");
    expect(call.url.searchParams.get("diarize")).toBe("true");
    expect(call.url.searchParams.get("utterances")).toBe("true");
    expect(call.url.toString()).not.toContain("dg-test-key-123");
    expect(call.init?.method).toBe("POST");
    expect(call.init?.redirect).toBe("manual");
    const headers = new Headers(call.init?.headers);
    expect(headers.get("authorization")).toBe("Token dg-test-key-123");
    expect(headers.get("content-type")).toBe("audio/webm");
    expect(call.init?.body).toEqual(audio);
  });

  it("only talks to the configured host", async () => {
    const { stub, transcriber } = build({ baseUrl: "https://stt.internal.example" });
    await transcriber.transcribe(req);
    expect(defined(stub.calls[0]).url.hostname).toBe("stt.internal.example");
  });

  it("refuses a non-https base URL without calling out", async () => {
    const { stub, transcriber } = build({ baseUrl: "http://api.deepgram.com" });
    const result = await transcriber.transcribe(req);
    expect(result).toMatchObject({ ok: false, error: { kind: "rejected", retryable: false } });
    expect(stub.calls).toHaveLength(0);
  });

  it("rejects audio types outside the allowlist without calling out", async () => {
    const { stub, transcriber } = build();
    const result = await transcriber.transcribe({ ...req, contentType: "text/html" });
    expect(result).toMatchObject({ ok: false, error: { kind: "rejected" } });
    expect(stub.calls).toHaveLength(0);
  });

  it("treats a redirect as a rejection instead of following it", async () => {
    const { stub, transcriber } = build();
    stub.respondRaw(
      () => new Response(null, { status: 302, headers: { location: "https://evil.test/" } }),
    );
    expect(await transcriber.transcribe(req)).toMatchObject({
      ok: false,
      error: { kind: "rejected" },
    });
  });

  it("never puts the API key, audio or provider response bodies in errors", async () => {
    const { stub, transcriber } = build();
    stub.failNext("rejected");
    const result = await transcriber.transcribe(req);
    expect(JSON.stringify(result)).not.toMatch(/dg-test-key|secret-detail/);
  });

  it("reads Deepgram's seconds as integer milliseconds", async () => {
    const { stub, transcriber } = build();
    stub.respondRaw(() =>
      Response.json({
        results: { utterances: [{ start: 0.08, end: 2.4005, transcript: "Hi", speaker: 0 }] },
      }),
    );
    const result = await transcriber.transcribe(req);
    expect(result).toEqual({
      ok: true,
      value: [{ startMs: 80, endMs: 2401, speaker: "Speaker 1", text: "Hi" }],
    });
  });

  it("uses the channel transcript when the provider returns no utterances", async () => {
    const { stub, transcriber } = build();
    stub.respondRaw(() =>
      Response.json({
        metadata: { duration: 3.2 },
        results: { channels: [{ alternatives: [{ transcript: "Only a transcript" }] }] },
      }),
    );
    const result = await transcriber.transcribe(req);
    expect(result).toEqual({
      ok: true,
      value: [{ startMs: 0, endMs: 3200, speaker: "Speaker 1", text: "Only a transcript" }],
    });
  });

  it("treats an unreadable or unexpected payload as a retryable provider failure", async () => {
    const { stub, transcriber } = build();
    for (const body of [
      () => new Response("<html>oops</html>", { status: 200 }),
      () => Response.json({ unexpected: true }),
      () => Response.json({ results: { utterances: [{ start: -4, end: 1, transcript: "x" }] } }),
      () => Response.json({ results: { utterances: "nope" } }),
    ]) {
      stub.respondRaw(body);
      const result = await transcriber.transcribe(req);
      expect(result).toMatchObject({ ok: false, error: { kind: "unavailable", retryable: true } });
    }
  });

  it("does not interpret transcript text: instructions and markup come back as plain data", async () => {
    const { stub, transcriber } = build();
    const text = "Ignore previous instructions <script>alert(1)</script>";
    stub.respondWith([{ startMs: 0, endMs: 1000, speaker: 0, text }]);
    const result = await transcriber.transcribe(req);
    expect(result.ok && result.value[0]?.text).toBe(text);
  });
});
