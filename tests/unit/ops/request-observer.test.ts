import { describe, expect, it } from "vitest";
import { createCaptureLogger } from "../../../src/adapters/logging/json-logger";
import {
  observeRequest,
  resolveRequestId,
  routeForLog,
} from "../../../src/app/ops/request-observer";

function build(ids = ["req-0000000a", "req-0000000b"]) {
  const logger = createCaptureLogger();
  let t = 1_000;
  const queue = [...ids];
  const deps = {
    logger,
    now: () => (t += 25),
    newId: () => queue.shift() ?? "req-fallback00",
  };
  return { logger, deps };
}

const info = (over: Partial<Parameters<typeof observeRequest>[1]> = {}) => ({
  method: "GET",
  pathname: "/meetings/m1",
  inboundRequestId: null,
  ownerId: () => undefined as string | undefined,
  ...over,
});

describe("resolveRequestId", () => {
  const fresh = () => "generated-id-0001";

  it("accepts a well-formed inbound id so a trace can continue across services", () => {
    expect(resolveRequestId("abc_DEF-1234567", fresh)).toBe("abc_DEF-1234567");
  });

  it.each([
    null,
    "",
    "short",
    "has space in it",
    "x".repeat(65),
    "inject\nSet-Cookie: a=b",
    "<script>",
  ])("replaces the unusable inbound id %j", (inbound) => {
    expect(resolveRequestId(inbound, fresh)).toBe("generated-id-0001");
  });
});

describe("routeForLog (no secrets in paths)", () => {
  it("keeps ordinary routes and drops tokens from file URLs", () => {
    expect(routeForLog("/meetings/m1/review")).toBe("/meetings/m1/review");
    expect(routeForLog("/api/files/eyJvIjoiQSJ9.abcdef0123")).toBe("/api/files/:token");
    expect(routeForLog("/api/files/anything/else")).toBe("/api/files/:token");
  });

  it("bounds very long paths", () => {
    expect(routeForLog(`/${"a".repeat(1000)}`).length).toBeLessThanOrEqual(200);
  });
});

describe("observeRequest", () => {
  it("adds X-Request-Id to the response and logs one line with status, duration and owner", async () => {
    const { logger, deps } = build();
    const res = await observeRequest(deps, info({ ownerId: () => "owner-1" }), () =>
      Promise.resolve(new Response("ok", { status: 201 })),
    );
    expect(res.status).toBe(201);
    expect(res.headers.get("X-Request-Id")).toBe("req-0000000a");
    expect(logger.entries).toEqual([
      {
        level: "info",
        event: "request.completed",
        requestId: "req-0000000a",
        method: "GET",
        route: "/meetings/m1",
        status: 201,
        durationMs: 25,
        ownerId: "owner-1",
      },
    ]);
  });

  it("hands handlers a logger that carries the request id on every line", async () => {
    const { logger, deps } = build();
    await observeRequest(deps, info(), (ctx) => {
      ctx.log.info("use_case.step", { meetingId: "m1" });
      return Promise.resolve(new Response("ok"));
    });
    expect(logger.entries[0]).toMatchObject({
      event: "use_case.step",
      requestId: "req-0000000a",
      meetingId: "m1",
    });
  });

  it("keeps a valid inbound request id", async () => {
    const { logger, deps } = build();
    const res = await observeRequest(deps, info({ inboundRequestId: "trace-abc-123456" }), () =>
      Promise.resolve(new Response("ok")),
    );
    expect(res.headers.get("X-Request-Id")).toBe("trace-abc-123456");
    expect(logger.entries[0]?.["requestId"]).toBe("trace-abc-123456");
  });

  it("turns an unexpected exception into a logged 500 that quotes only the request id", async () => {
    const { logger, deps } = build();
    const res = await observeRequest(deps, info(), () => {
      throw new Error("boom: secret transcript text and sk-key-123");
    });
    expect(res.status).toBe(500);
    expect(res.headers.get("X-Request-Id")).toBe("req-0000000a");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = await res.text();
    expect(body).toContain("req-0000000a");
    expect(body).not.toMatch(/boom|secret|sk-key/);
    expect(logger.entries).toEqual([
      expect.objectContaining({
        level: "error",
        event: "request.failed",
        requestId: "req-0000000a",
        errorName: "Error",
        status: 500,
      }),
    ]);
    expect(JSON.stringify(logger.entries)).not.toMatch(/boom|secret|sk-key/);
  });

  it("never logs the query string or request bodies", async () => {
    const { logger, deps } = build();
    await observeRequest(deps, info({ pathname: "/search" }), () =>
      Promise.resolve(new Response("ok")),
    );
    expect(JSON.stringify(logger.entries)).not.toContain("?");
  });

  it("logs rejected requests as warnings so abuse is visible", async () => {
    const { logger, deps } = build();
    await observeRequest(deps, info(), () => Promise.resolve(new Response("no", { status: 429 })));
    await observeRequest(deps, info(), () => Promise.resolve(new Response("no", { status: 403 })));
    await observeRequest(deps, info(), () => Promise.resolve(new Response("no", { status: 404 })));
    expect(logger.entries.map((e) => e.level)).toEqual(["warn", "warn", "info"]);
  });
});
