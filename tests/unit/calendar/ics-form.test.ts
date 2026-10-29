import { describe, expect, it } from "vitest";
import { ICS_LIMITS } from "../../../src/domain/calendar/ics";
import { readIcsConfirm, readIcsUpload } from "../../../src/app/calendar/ics-form";

const CAL = "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n";

function form(entries: Record<string, string | File | (string | File)[]>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(entries)) {
    for (const v of Array.isArray(value) ? value : [value]) data.append(name, v);
  }
  return data;
}

const file = (content: BlobPart, name = "calendar.ics", type = "text/calendar") =>
  new File([content], name, { type });

describe("readIcsUpload", () => {
  it("reads an uploaded .ics file", async () => {
    const result = await readIcsUpload(
      form({ csrf_token: "t", file: file(CAL), floating_zone: "Europe/Paris" }),
    );
    expect(result).toEqual({ ok: true, value: { text: CAL, floatingZone: "Europe/Paris" } });
  });

  it("reads pasted text", async () => {
    const result = await readIcsUpload(
      form({ csrf_token: "t", ics_text: CAL, floating_zone: "UTC" }),
    );
    expect(result).toEqual({ ok: true, value: { text: CAL, floatingZone: "UTC" } });
  });

  it("treats the empty file part a browser sends when nothing was chosen as absent", async () => {
    const result = await readIcsUpload(
      form({ csrf_token: "t", file: file("", ""), ics_text: CAL, floating_zone: "UTC" }),
    );
    expect(result.ok && result.value.text).toBe(CAL);
  });

  it("asks for something when neither a file nor text was given", async () => {
    expect(
      await readIcsUpload(
        form({ csrf_token: "t", file: file("", ""), ics_text: "  ", floating_zone: "UTC" }),
      ),
    ).toEqual({
      ok: false,
      error: { code: "no_input" },
    });
  });

  it("refuses a file and pasted text together instead of guessing which to use", async () => {
    expect(
      await readIcsUpload(
        form({ csrf_token: "t", file: file(CAL), ics_text: CAL, floating_zone: "UTC" }),
      ),
    ).toEqual({
      ok: false,
      error: { code: "both_sources" },
    });
  });

  it("accepts the content types browsers give an .ics file", async () => {
    for (const type of ["text/calendar", "text/plain", "application/octet-stream", ""]) {
      const result = await readIcsUpload(
        form({ csrf_token: "t", file: file(CAL, "x.ICS", type), floating_zone: "UTC" }),
      );
      expect(result.ok, type).toBe(true);
    }
  });

  it("refuses other file names and content types", async () => {
    for (const [name, type] of [
      ["x.exe", "application/octet-stream"],
      ["x.ics.exe", "text/calendar"],
      ["x.pdf", "application/pdf"],
      ["x.ics", "application/pdf"],
      ["x.ics", "text/html"],
      ["x", "text/calendar"],
    ] as const) {
      const result = await readIcsUpload(
        form({ csrf_token: "t", file: file(CAL, name, type), floating_zone: "UTC" }),
      );
      expect(result, `${name} ${type}`).toEqual({ ok: false, error: { code: "wrong_type" } });
    }
  });

  it("refuses an oversize file and oversize pasted text, never truncating", async () => {
    const big = "a".repeat(ICS_LIMITS.maxBytes + 1);
    expect(
      await readIcsUpload(form({ csrf_token: "t", file: file(big), floating_zone: "UTC" })),
    ).toEqual({ ok: false, error: { code: "too_large" } });
    expect(
      await readIcsUpload(form({ csrf_token: "t", ics_text: big, floating_zone: "UTC" })),
    ).toEqual({ ok: false, error: { code: "too_large" } });
  });

  it("counts bytes, not characters, against the limit", async () => {
    const multibyte = "é".repeat(ICS_LIMITS.maxBytes / 2 + 1);
    expect(
      await readIcsUpload(form({ csrf_token: "t", ics_text: multibyte, floating_zone: "UTC" })),
    ).toEqual({ ok: false, error: { code: "too_large" } });
  });

  it("refuses bytes that are not valid UTF-8 and UTF-16 files", async () => {
    const latin1 = new Uint8Array([0x42, 0x45, 0x47, 0xe9, 0xff, 0xfe]);
    expect(
      await readIcsUpload(form({ csrf_token: "t", file: file(latin1), floating_zone: "UTC" })),
    ).toEqual({ ok: false, error: { code: "bad_encoding" } });
    const utf16 = new Uint8Array([0xff, 0xfe, 0x42, 0x00, 0x45, 0x00]);
    expect(
      await readIcsUpload(form({ csrf_token: "t", file: file(utf16), floating_zone: "UTC" })),
    ).toEqual({ ok: false, error: { code: "bad_encoding" } });
  });

  it("drops a UTF-8 byte order mark", async () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(CAL)]);
    const result = await readIcsUpload(
      form({ csrf_token: "t", file: file(bytes), floating_zone: "UTC" }),
    );
    expect(result.ok && result.value.text).toBe(CAL);
  });

  it("rejects unknown fields and repeated fields", async () => {
    expect(
      await readIcsUpload(
        form({ csrf_token: "t", ics_text: CAL, floating_zone: "UTC", owner_id: "owner-b" }),
      ),
    ).toEqual({
      ok: false,
      error: { code: "malformed" },
    });
    expect(
      await readIcsUpload(form({ csrf_token: "t", ics_text: [CAL, CAL], floating_zone: "UTC" })),
    ).toEqual({
      ok: false,
      error: { code: "malformed" },
    });
    expect(
      await readIcsUpload(
        form({ csrf_token: "t", file: [file(CAL), file(CAL)], floating_zone: "UTC" }),
      ),
    ).toEqual({
      ok: false,
      error: { code: "malformed" },
    });
  });

  it("defaults the time zone to UTC and refuses an unknown one", async () => {
    const none = await readIcsUpload(form({ csrf_token: "t", ics_text: CAL }));
    expect(none.ok && none.value.floatingZone).toBe("UTC");
    expect(
      await readIcsUpload(form({ csrf_token: "t", ics_text: CAL, floating_zone: "Mars/Base" })),
    ).toEqual({
      ok: false,
      error: { code: "bad_zone" },
    });
  });
});

describe("readIcsConfirm", () => {
  it("reads the text, the zone and every selected event id", () => {
    const result = readIcsConfirm(
      form({
        csrf_token: "t",
        ics_text: CAL,
        floating_zone: "UTC",
        event: ["a", "b|20261109T080000Z"],
      }),
    );
    expect(result).toEqual({
      ok: true,
      value: { text: CAL, floatingZone: "UTC", selectedIds: ["a", "b|20261109T080000Z"] },
    });
  });

  it("allows an empty selection to reach the use case, which names the problem", () => {
    const result = readIcsConfirm(form({ csrf_token: "t", ics_text: CAL, floating_zone: "UTC" }));
    expect(result.ok && result.value.selectedIds).toEqual([]);
  });

  it("rejects unknown fields (such as an owner id), files and a missing text", () => {
    expect(readIcsConfirm(form({ csrf_token: "t", ics_text: CAL, owner_id: "x" })).ok).toBe(false);
    expect(readIcsConfirm(form({ csrf_token: "t", ics_text: file(CAL) })).ok).toBe(false);
    expect(readIcsConfirm(form({ csrf_token: "t" })).ok).toBe(false);
  });

  it("refuses over-long ids and an oversize selection before anything else runs", () => {
    expect(
      readIcsConfirm(form({ csrf_token: "t", ics_text: CAL, event: "x".repeat(400) })).ok,
    ).toBe(false);
    const many = Array.from({ length: ICS_LIMITS.maxEvents + 1 }, (_, i) => `e${String(i)}`);
    expect(readIcsConfirm(form({ csrf_token: "t", ics_text: CAL, event: many })).ok).toBe(false);
  });
});
