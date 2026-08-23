import * as Atom from "atom"
import {Signature, SignatureParameter} from "atom-ide-base"
import * as jsonc from "jsonc-parser"
import * as fs from "fs"
import * as path from "path"
import type * as lsp from "vscode-languageserver-protocol"

/**
 * 1-based line/offset, matching the old tsserver protocol convention. Kept as the app-wide
 * internal coordinate type (distinct from LSP's 0-based `Range`/`Position`) since most of the
 * UI code and the `execute()` request-building call sites are written against it.
 */
export interface Location {
  line: number
  offset: number
}

export interface TextSpan {
  start: Location
  end: Location
}

export interface CodeEdit extends TextSpan {
  newText: string
}

export type FormatCodeSettings = Record<string, unknown>
export type UserPreferences = Record<string, unknown>

export interface LocationRangeQuery extends Location {
  endLine: number
  endOffset: number
}

export interface FileLocationQuery extends Location {
  file: string
}

export function pointToLocation(point: Atom.PointLike): Location {
  return {line: point.row + 1, offset: point.column + 1}
}

export function locationToPoint(loc: Location): Atom.Point {
  return new Atom.Point(loc.line - 1, loc.offset - 1)
}

export function spanToRange(span: TextSpan): Atom.Range {
  return locationsToRange(span.start, span.end)
}

export function locationsToRange(start: Location, end: Location): Atom.Range {
  return new Atom.Range(locationToPoint(start), locationToPoint(end))
}

export function rangeToLocationRange(range: Atom.Range): LocationRangeQuery {
  return {
    line: range.start.row + 1,
    offset: range.start.column + 1,
    endLine: range.end.row + 1,
    endOffset: range.end.column + 1,
  }
}

/** LSP `Position` is 0-based; our internal `Location` is 1-based. */
export function lspPositionToLocation(pos: lsp.Position): Location {
  return {line: pos.line + 1, offset: pos.character + 1}
}

export function locationToLspPosition(loc: Location): lsp.Position {
  return {line: loc.line - 1, character: loc.offset - 1}
}

export function lspRangeToSpan(range: lsp.Range): TextSpan {
  return {start: lspPositionToLocation(range.start), end: lspPositionToLocation(range.end)}
}

export function lspTextEditToCodeEdit(edit: lsp.TextEdit): CodeEdit {
  return {...lspRangeToSpan(edit.range), newText: edit.newText}
}

/** LSP `Position` is already 0-based line/character, exactly matching `Atom.Point`. */
export function lspPositionToPoint(pos: lsp.Position): Atom.Point {
  return new Atom.Point(pos.line, pos.character)
}

export function lspRangeToAtomRange(range: lsp.Range): Atom.Range {
  return new Atom.Range(lspPositionToPoint(range.start), lspPositionToPoint(range.end))
}

export function uriToFilePath(uri: string): string {
  return new URL(uri).pathname
}

export interface FileEdit {
  fileName: string
  textChanges: CodeEdit[]
}

/** Flattens an LSP `WorkspaceEdit` (which can describe edits via `changes`, `documentChanges`, or
 * both) into the app's internal per-file edit list, consumed by `pluginManager.ts`'s
 * `applyEdits`. */
export function lspWorkspaceEditToFileEdits(
  edit: lsp.WorkspaceEdit | null | undefined,
): FileEdit[] {
  if (!edit) return []
  const out: FileEdit[] = []
  if (edit.changes) {
    for (const [uri, edits] of Object.entries(edit.changes)) {
      out.push({fileName: uriToFilePath(uri), textChanges: edits.map(lspTextEditToCodeEdit)})
    }
  }
  if (edit.documentChanges) {
    for (const dc of edit.documentChanges) {
      if ("textDocument" in dc) {
        out.push({
          fileName: uriToFilePath(dc.textDocument.uri),
          textChanges: (dc.edits as lsp.TextEdit[]).map(lspTextEditToCodeEdit),
        })
      }
      // CreateFile/RenameFile/DeleteFile resource operations aren't applied here; none of our
      // current LSP call sites produce them.
    }
  }
  return out
}

export interface FileRange {
  file: string
  range: Atom.Range
}

/** `textDocument/definition` (and friends) may reply with a single `Location`, a `Location[]`, an
 * array of `LocationLink`s, or nothing at all. Normalize all of those into one flat shape. */
export function normalizeLocations(
  result: lsp.Location | lsp.Location[] | lsp.LocationLink[] | null | undefined,
): FileRange[] {
  if (!result) return []
  const arr = Array.isArray(result) ? result : [result]
  return arr.map(
    (loc): FileRange =>
      "targetUri" in loc
        ? {file: uriToFilePath(loc.targetUri), range: lspRangeToAtomRange(loc.targetRange)}
        : {file: uriToFilePath(loc.uri), range: lspRangeToAtomRange(loc.range)},
  )
}

export interface ProjectConfig {
  formatCodeOptions: FormatCodeSettings
  compileOnSave: boolean
  preferences: UserPreferences
}

export function getProjectConfig(configFile: string): ProjectConfig {
  const config = loadConfig(configFile)
  const options = (config as {formatCodeOptions?: FormatCodeSettings}).formatCodeOptions

  return {
    formatCodeOptions: {
      indentSize: atom.config.get("editor.tabLength"),
      tabSize: atom.config.get("editor.tabLength"),
      ...options,
    },
    compileOnSave: !!config.compileOnSave,
    preferences: config.preferences ? config.preferences : {},
  }
}

/** Reads a tsconfig.json (tolerating comments/trailing commas) and follows its `extends` chain.
 * Replaces the old `ts.readConfigFile`, which relied on the classic `typescript` JS API that
 * TypeScript 7 no longer exports. */
function loadConfig(configFile: string): Partial<ProjectConfig> {
  if (path.extname(configFile) !== ".json") {
    configFile = `${configFile}.json`
  }
  let config: {[key: string]: unknown}
  try {
    config = (jsonc.parse(fs.readFileSync(configFile, "utf8")) as typeof config) ?? {}
  } catch {
    return {}
  }
  if (typeof config.extends === "string") {
    const extendsPath = path.join(path.dirname(configFile), config.extends)
    const extendsConfig = loadConfig(extendsPath)
    config = Object.assign({}, extendsConfig, config)
  }
  return config
}

export function lspSignatureToSignature(sig: lsp.SignatureInformation): Signature {
  return {
    label: sig.label,
    documentation: markupToStr(sig.documentation),
    parameters: (sig.parameters ?? []).map((p) => lspParameterToSignatureParameter(sig, p)),
  }
}

function lspParameterToSignatureParameter(
  sig: lsp.SignatureInformation,
  p: lsp.ParameterInformation,
): SignatureParameter {
  const label = Array.isArray(p.label) ? sig.label.slice(p.label[0], p.label[1]) : p.label
  return {
    label,
    documentation: markupToStr(p.documentation),
  }
}

function markupToStr(doc: string | lsp.MarkupContent | undefined): string {
  if (doc === undefined) return ""
  return typeof doc === "string" ? doc : doc.value
}
