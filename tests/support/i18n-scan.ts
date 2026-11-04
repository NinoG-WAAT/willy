import { posix } from "node:path";
import { convertToTSX } from "@astrojs/compiler";
import ts from "typescript";
import { placeholderNames } from "../../src/i18n/translate";

/**
 * Finds every translatable string in the source (`t("...")`, `tn("...", "...")`, `msg("...")`)
 * with the TypeScript compiler API, and checks the French catalog against them. Used by
 * tests/unit/i18n/catalog.test.ts; tested on its own in scan-catalog.test.ts because a scanner
 * that silently finds nothing would make the catalog test pass for the wrong reason.
 */

export interface SourceFile {
  /** Repo-relative, forward slashes: `src/app/identity/handle-sign-in.ts`. */
  path: string;
  text: string;
}

export type CallName = "t" | "tn" | "msg";

export interface Occurrence {
  file: string;
  line: number;
  call: CallName;
  source: string;
}

export interface Scan {
  occurrences: Occurrence[];
  /** Calls whose first argument is not a string literal: they cannot be extracted. */
  dynamic: { file: string; line: number; call: string }[];
  /** A sentence built from translated pieces: `t("a") + x`, or `${t("a")} ...`. */
  concatenations: { file: string; line: number }[];
}

/** The modules that export `t`/`tn`/`msg`, as repo-relative paths without extension. */
const I18N_MODULES = new Set(["src/i18n/translate", "src/scripts/i18n"]);
const CALLS: readonly CallName[] = ["t", "tn", "msg"];

function resolveSpecifier(fromPath: string, specifier: string): string {
  if (!specifier.startsWith(".")) return specifier;
  return posix.normalize(posix.join(posix.dirname(fromPath), specifier)).replace(/\.(ts|js)$/, "");
}

function isCallName(name: string): name is CallName {
  return (CALLS as readonly string[]).includes(name);
}

/** A string literal, a plain template literal, or `+` of those: text known without running code. */
function staticText(node: ts.Expression | undefined): string | undefined {
  if (node === undefined) return undefined;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isParenthesizedExpression(node)) return staticText(node.expression);
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = staticText(node.left);
    const right = staticText(node.right);
    return left !== undefined && right !== undefined ? left + right : undefined;
  }
  return undefined;
}

function unwrap(node: ts.Expression): ts.Expression {
  return ts.isParenthesizedExpression(node) ? unwrap(node.expression) : node;
}

interface Parsed {
  source: ts.SourceFile;
  /** For Astro files: original text, so line numbers point at what the author wrote. */
  original: string | null;
}

async function parse(file: SourceFile): Promise<Parsed> {
  if (!file.path.endsWith(".astro")) {
    return {
      source: ts.createSourceFile(
        file.path,
        file.text,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS,
      ),
      original: null,
    };
  }
  // Astro's own compiler turns the page into TSX: frontmatter, then the template as JSX, so the
  // calls inside `{...}` expressions are real AST nodes.
  const { code } = await convertToTSX(file.text, { filename: file.path });
  return {
    source: ts.createSourceFile(file.path, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX),
    original: file.text,
  };
}

/** Line of the next place the author wrote this text, so Astro occurrences read naturally. */
function originalLineLocator(original: string): (needle: string, fallback: number) => number {
  const lines = original.split("\n");
  const cursors = new Map<string, number>();
  return (needle, fallback) => {
    const snippet = needle.slice(0, 24);
    if (snippet === "") return fallback;
    const from = cursors.get(snippet) ?? 0;
    for (let i = from; i < lines.length; i++) {
      if ((lines[i] ?? "").includes(snippet)) {
        cursors.set(snippet, i + 1);
        return i + 1;
      }
    }
    return fallback;
  };
}

function i18nBindings(source: ts.SourceFile, path: string) {
  const named = new Map<string, CallName>();
  const namespaces = new Set<string>();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier))
      continue;
    if (!I18N_MODULES.has(resolveSpecifier(path, statement.moduleSpecifier.text))) continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings === undefined) continue;
    if (ts.isNamespaceImport(bindings)) namespaces.add(bindings.name.text);
    else {
      for (const element of bindings.elements) {
        const imported = (element.propertyName ?? element.name).text;
        if (isCallName(imported)) named.set(element.name.text, imported);
      }
    }
  }
  return { named, namespaces };
}

function scanOne(file: SourceFile, parsed: Parsed, scan: Scan): void {
  const { source } = parsed;
  const { named, namespaces } = i18nBindings(source, file.path);
  if (named.size === 0 && namespaces.size === 0) return;
  const locate = parsed.original === null ? null : originalLineLocator(parsed.original);
  const lineOf = (node: ts.Node, text?: string): number => {
    const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
    return locate !== null && text !== undefined ? locate(text, line) : line;
  };

  const callName = (expression: ts.Expression): CallName | undefined => {
    const callee = unwrap(expression);
    if (ts.isIdentifier(callee)) return named.get(callee.text);
    if (
      ts.isPropertyAccessExpression(callee) &&
      ts.isIdentifier(callee.expression) &&
      namespaces.has(callee.expression.text) &&
      isCallName(callee.name.text)
    ) {
      return callee.name.text;
    }
    return undefined;
  };
  const translatedCall = (node: ts.Expression): boolean => {
    const inner = unwrap(node);
    if (!ts.isCallExpression(inner)) return false;
    const name = callName(inner.expression);
    return name === "t" || name === "tn";
  };

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const name = callName(node.expression);
      if (name !== undefined) {
        const args = name === "tn" ? [node.arguments[0], node.arguments[1]] : [node.arguments[0]];
        const texts = args.map(staticText);
        if (texts.every((text) => text !== undefined)) {
          for (const text of texts) {
            scan.occurrences.push({
              file: file.path,
              line: lineOf(node, text),
              call: name,
              source: text,
            });
          }
        } else {
          scan.dynamic.push({ file: file.path, line: lineOf(node), call: name });
        }
      }
    }
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.PlusToken &&
      (translatedCall(node.left) || translatedCall(node.right))
    ) {
      scan.concatenations.push({ file: file.path, line: lineOf(node) });
    }
    if (
      ts.isTemplateExpression(node) &&
      node.templateSpans.some((span) => translatedCall(span.expression))
    ) {
      scan.concatenations.push({ file: file.path, line: lineOf(node) });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

export async function scanSources(files: SourceFile[]): Promise<Scan> {
  const scan: Scan = { occurrences: [], dynamic: [], concatenations: [] };
  for (const file of files) scanOne(file, await parse(file), scan);
  return scan;
}

/** Relative imports (static, `export ... from`, `import()`) of a TypeScript file. */
function relativeImports(file: SourceFile): string[] {
  const source = ts.createSourceFile(
    file.path,
    file.text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const found: string[] = [];
  const add = (specifier: string): void => {
    if (specifier.startsWith(".")) found.push(resolveSpecifier(file.path, specifier));
  };
  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      add(node.moduleSpecifier.text);
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] !== undefined &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      add(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/**
 * Everything a client script (`src/scripts/**`) can end up bundling: those files and every module
 * they import, transitively. Their strings must be in the small client catalog.
 */
export function clientReachableFiles(files: SourceFile[]): string[] {
  const byBase = new Map<string, SourceFile>();
  for (const file of files) byBase.set(file.path.replace(/\.(ts|astro)$/, ""), file);
  const reached = new Set<string>();
  const queue = files.filter((f) => f.path.startsWith("src/scripts/") && f.path.endsWith(".ts"));
  while (queue.length > 0) {
    const file = queue.pop();
    if (file === undefined || reached.has(file.path)) continue;
    reached.add(file.path);
    if (!file.path.endsWith(".ts")) continue;
    for (const base of relativeImports(file)) {
      const target = byBase.get(base) ?? byBase.get(posix.join(base, "index"));
      if (target !== undefined) queue.push(target);
    }
  }
  return [...reached];
}

export interface CatalogInputs {
  scan: Scan;
  /** The merged French catalog. */
  catalog: Readonly<Record<string, string>>;
  /** Strings that are the same word in French: source -> reason. */
  sameInFrench: Readonly<Record<string, string>>;
  /** The French strings client bundles carry. */
  clientCatalog: Readonly<Record<string, string>>;
  /** Files client scripts can bundle (see `clientReachableFiles`). */
  clientFiles: readonly string[];
  /** Files allowed to call `t()` with a value that is not a literal: path -> reason. */
  allowedDynamic: Readonly<Record<string, string>>;
  /** Files allowed to join translated pieces: path -> reason. */
  allowedConcatenation: Readonly<Record<string, string>>;
}

const MARKUP = /<\/?[A-Za-z][^<>]*>|&[A-Za-z#][A-Za-z0-9]*;/;
const hasReason = (reason: string | undefined): boolean => (reason ?? "").trim() !== "";
const show = (text: string): string => JSON.stringify(text);
const sameSet = (a: string[], b: string[]): boolean =>
  [...new Set(a)].sort().join(",") === [...new Set(b)].sort().join(",");

/** Every way the catalog can disagree with the code. Empty means consistent. */
export function checkCatalog(input: CatalogInputs): string[] {
  const problems: string[] = [];
  const { scan, catalog } = input;

  const firstUse = new Map<string, Occurrence>();
  for (const occurrence of scan.occurrences) {
    if (!firstUse.has(occurrence.source)) firstUse.set(occurrence.source, occurrence);
  }
  const where = (o: Occurrence): string => `${o.file}:${String(o.line)}`;

  for (const o of firstUse.values()) {
    if (!Object.hasOwn(catalog, o.source)) {
      problems.push(`missing-translation: ${where(o)} ${show(o.source)} has no French entry`);
    }
    if (o.source !== o.source.trim()) {
      problems.push(
        `edge-whitespace: ${where(o)} ${show(o.source)} starts or ends with whitespace: build the sentence in one t() with {params}`,
      );
    }
    if (MARKUP.test(o.source)) {
      problems.push(
        `markup: ${where(o)} ${show(o.source)} looks like HTML; strings are plain text`,
      );
    }
  }

  for (const [source, translation] of Object.entries(catalog)) {
    if (!firstUse.has(source)) {
      problems.push(`unused-entry: French entry ${show(source)} matches no t()/tn()/msg() in src`);
      continue;
    }
    if (translation.trim() === "") {
      problems.push(`empty: the French entry for ${show(source)} is empty`);
      continue;
    }
    if (!sameSet(placeholderNames(source), placeholderNames(translation))) {
      problems.push(
        `param-mismatch: ${show(source)} uses {${placeholderNames(source).join("}, {")}} but its French uses {${placeholderNames(translation).join("}, {")}}`,
      );
    }
    if (MARKUP.test(translation)) {
      problems.push(
        `markup: the French entry for ${show(source)} looks like HTML; translations are plain text`,
      );
    }
    const translatable = /\p{L}/u.test(source.replace(/\{[A-Za-z0-9_]+\}/g, ""));
    if (translation === source && translatable && !hasReason(input.sameInFrench[source])) {
      problems.push(
        `identical: the French entry for ${show(source)} equals the English; if it is the same in French, add it to sameInFrench with a reason`,
      );
    }
  }

  for (const source of Object.keys(input.sameInFrench)) {
    // A blank reason on an identical entry is reported as `identical` above.
    if (!Object.hasOwn(catalog, source) || catalog[source] !== source) {
      problems.push(
        `stale-allowlist: sameInFrench ${show(source)} is not an identical French entry any more; remove it`,
      );
    }
  }

  const dynamicFiles = new Set(scan.dynamic.map((d) => d.file));
  for (const call of scan.dynamic) {
    if (!hasReason(input.allowedDynamic[call.file])) {
      problems.push(
        `non-literal: ${call.file}:${String(call.line)} ${call.call}() needs a string literal as its first argument (mark table values with msg() and allowlist the file with a reason)`,
      );
    }
  }
  for (const file of Object.keys(input.allowedDynamic)) {
    if (!dynamicFiles.has(file))
      problems.push(`stale-allowlist: allowedDynamic ${file} has no non-literal call; remove it`);
  }

  const concatFiles = new Set(scan.concatenations.map((c) => c.file));
  for (const c of scan.concatenations) {
    if (!hasReason(input.allowedConcatenation[c.file])) {
      problems.push(
        `concatenation: ${c.file}:${String(c.line)} joins a translated string to other text; use one t() with {params}`,
      );
    }
  }
  for (const file of Object.keys(input.allowedConcatenation)) {
    if (!concatFiles.has(file))
      problems.push(`stale-allowlist: allowedConcatenation ${file} joins nothing; remove it`);
  }

  const clientFiles = new Set(input.clientFiles);
  const clientSources = new Map<string, Occurrence>();
  for (const o of scan.occurrences) {
    if (clientFiles.has(o.file) && !clientSources.has(o.source)) clientSources.set(o.source, o);
  }
  for (const o of clientSources.values()) {
    if (!Object.hasOwn(input.clientCatalog, o.source)) {
      problems.push(
        `client-catalog-missing: ${where(o)} ${show(o.source)} is reachable from a client script but is not in src/i18n/fr/scripts.ts`,
      );
    }
  }
  for (const source of Object.keys(input.clientCatalog)) {
    if (!clientSources.has(source)) {
      problems.push(
        `client-catalog-unused: src/i18n/fr/scripts.ts has ${show(source)} but no client script uses it`,
      );
    }
  }
  return problems;
}
