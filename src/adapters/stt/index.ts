import type { Transcriber } from "../../ports/transcriber";
import type { SttConfig } from "./config";
import { createDeepgramTranscriber } from "./deepgram-transcriber";
import { createFakeTranscriber } from "./fake-transcriber";

/** Chooses the adapter for the configuration: the deterministic fake or the real provider. */
export function createTranscriber(config: SttConfig, doFetch: typeof fetch): Transcriber {
  if (config.mode === "fake") return createFakeTranscriber();
  return createDeepgramTranscriber({
    fetch: doFetch,
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    timeoutMs: config.timeoutMs,
  });
}
