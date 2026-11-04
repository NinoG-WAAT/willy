import { beforeAll, describe, expect, it } from "vitest";
import {
  currentRequestLocale,
  installI18n,
  runWithLocale,
} from "../../../src/adapters/i18n/request-locale";
import { createCaptureLogger } from "../../../src/adapters/logging/json-logger";
import { currentLocale, t } from "../../../src/i18n/translate";

const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("request locale (AsyncLocalStorage adapter)", () => {
  const logger = createCaptureLogger();

  beforeAll(() => {
    installI18n({ defaultLocale: () => "en", strict: false, logger: () => logger });
  });

  it("outside a request the resolver answers with the configured default", () => {
    expect(currentRequestLocale()).toBeUndefined();
    expect(currentLocale()).toBe("en");
  });

  it("holds the locale across awaits, timers and nested calls", async () => {
    await runWithLocale("fr", async () => {
      expect(currentLocale()).toBe("fr");
      await tick(5);
      expect(currentLocale()).toBe("fr");
      await Promise.all([
        tick(1),
        Promise.resolve().then(() => expect(currentLocale()).toBe("fr")),
      ]);
      setTimeout(() => {
        expect(currentLocale()).toBe("fr");
      }, 0);
    });
    expect(currentLocale()).toBe("en");
  });

  it("keeps two interleaved requests apart: one request's locale never leaks into another", async () => {
    const seen: string[] = [];
    const request = (locale: "en" | "fr", ms: number) =>
      runWithLocale(locale, async () => {
        seen.push(`${locale} start ${currentLocale()}`);
        await tick(ms);
        seen.push(`${locale} end ${currentLocale()}`);
      });
    await Promise.all([request("fr", 20), request("en", 5), request("fr", 10)]);
    expect(seen.filter((line) => line.startsWith("fr")).every((line) => line.endsWith("fr"))).toBe(
      true,
    );
    expect(seen.filter((line) => line.startsWith("en")).every((line) => line.endsWith("en"))).toBe(
      true,
    );
    expect(seen).toHaveLength(6);
  });

  it("holds the locale while a response body is produced after next() returned (streaming)", async () => {
    const stream = runWithLocale(
      "fr",
      () =>
        new ReadableStream<string>({
          async start(controller) {
            await tick(5);
            controller.enqueue(t("Sign in"));
            await tick(5);
            controller.enqueue(currentLocale());
            controller.close();
          },
        }),
    );
    const chunks: string[] = [];
    for await (const chunk of stream) chunks.push(chunk);
    expect(chunks).toEqual(["Se connecter", "fr"]);
  });

  it("registers the French catalog: t() translates inside a French request only", () => {
    expect(runWithLocale("fr", () => t("Sign in"))).toBe("Se connecter");
    expect(t("Sign in")).toBe("Sign in");
  });

  it("logs a missing French string once per key, without failing, naming locale and key", () => {
    const missing = "A string nobody translated";
    expect(runWithLocale("fr", () => t(missing))).toBe(missing);
    expect(runWithLocale("fr", () => t(missing))).toBe(missing);
    const lines = logger.entries.filter((e) => e.event === "i18n.missing_translation");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ locale: "fr", source: missing });
  });
});
