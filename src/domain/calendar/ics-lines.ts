import { err, ok, type Result } from "../platform/result";

/** One RFC 5545 content line: NAME;PARAM=value:VALUE. Names and parameter names are upper-cased. */
export interface IcsLine {
  name: string;
  params: ReadonlyMap<string, string>;
  value: string;
}

export type LineLimitCode = "too_many_lines" | "line_too_long" | "invalid_characters";

export interface LineLimits {
  maxLines: number;
  maxLineLength: number;
}

// Everything but TAB, CR and LF below U+0020, plus DEL: binary data, not calendar text.
// A single character class, so there is no backtracking to attack.
const FORBIDDEN_CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const LINE_BREAK = /\r\n|\n|\r/;

/**
 * Splits text into logical lines: handles CRLF, LF and CR endings, and unfolds continuation lines
 * (a line starting with a space or tab continues the previous one). Work is linear in the input
 * and stops as soon as a limit is exceeded, so a hostile file never costs more than its size.
 */
export function unfoldLines(text: string, limits: LineLimits): Result<string[], LineLimitCode> {
  if (FORBIDDEN_CONTROL.test(text)) return err("invalid_characters");
  const physical = text.split(LINE_BREAK);
  if (physical.length > limits.maxLines) return err("too_many_lines");

  const logical: string[] = [];
  let parts: string[] = [];
  let length = 0;
  const flush = () => {
    if (parts.length > 0) logical.push(parts.length === 1 ? (parts[0] ?? "") : parts.join(""));
    parts = [];
    length = 0;
  };
  for (const line of physical) {
    const continuation = line.startsWith(" ") || line.startsWith("\t");
    if (continuation && parts.length > 0) {
      length += line.length - 1;
      if (length > limits.maxLineLength) return err("line_too_long");
      parts.push(line.slice(1));
      continue;
    }
    flush();
    if (line.length > limits.maxLineLength) return err("line_too_long");
    parts = [line];
    length = line.length;
  }
  flush();
  return ok(logical.filter((l) => l.length > 0));
}

/**
 * Parses one unfolded line by scanning, never by regular expression. Handles quoted parameter
 * values that contain ':' ';' or ','. Returns null for a line with no value separator or an
 * unterminated quote; the caller ignores such lines.
 */
export function parseContentLine(line: string): IcsLine | null {
  const n = line.length;
  let i = 0;
  while (i < n && line[i] !== ";" && line[i] !== ":") i++;
  if (i >= n || i === 0) return null;
  const name = line.slice(0, i).toUpperCase();

  const params = new Map<string, string>();
  while (line[i] === ";") {
    i++;
    const nameStart = i;
    while (i < n && line[i] !== "=" && line[i] !== ";" && line[i] !== ":") i++;
    const paramName = line.slice(nameStart, i).toUpperCase();
    let paramValue = "";
    if (line[i] === "=") {
      i++;
      if (line[i] === '"') {
        const close = line.indexOf('"', i + 1);
        if (close === -1) return null;
        paramValue = line.slice(i + 1, close);
        i = close + 1;
        // Further values of a list ("a","b") are not used by anything we read.
        while (i < n && line[i] !== ";" && line[i] !== ":") i++;
      } else {
        const valueStart = i;
        while (i < n && line[i] !== ";" && line[i] !== ":") i++;
        paramValue = line.slice(valueStart, i);
      }
    }
    if (paramName !== "" && !params.has(paramName)) params.set(paramName, paramValue);
  }
  if (line[i] !== ":") return null;
  return { name, params, value: line.slice(i + 1) };
}

/** RFC 5545 3.3.11 TEXT: \n and \N are newlines; \\ \; \, and any other escaped character stand for themselves. */
export function unescapeText(value: string): string {
  return value.replace(/\\([\s\S]?)/g, (_match, next: string) =>
    next === "n" || next === "N" ? "\n" : next,
  );
}
