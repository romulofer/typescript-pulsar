// more: https://github.com/atom-community/autocomplete-plus/wiki/Provider-API
import * as Atom from "atom"
import * as ACP from "atom/autocomplete-plus"
import * as fuzzaldrin from "fuzzaldrin"
import type * as lsp from "vscode-languageserver-protocol"
import {GetClientFunction, TSClient} from "../../client"
import {CompletionItemKind} from "../../client/lspConstants"
import {handlePromise} from "../../utils"
import {ApplyEdits} from "../pluginManager"
import {FileLocationQuery, lspWorkspaceEditToFileEdits, typeScriptScopes} from "./utils"

type SuggestionWithDetails = ACP.TextSuggestion & {
  replacementRange?: Atom.Range
  isMemberCompletion?: boolean
  identifier?: lsp.CompletionItem
  hasAction?: boolean
}

interface Details {
  details: lsp.CompletionItem
  rightLabel: string
  description?: string
}

export class AutocompleteProvider implements ACP.AutocompleteProvider {
  public selector = typeScriptScopes()
    .map((x) => (x.includes(".") ? `.${x}` : x))
    .join(", ")

  public inclusionPriority = atom.config.get("pulsar-typescript").autocompletionInclusionPriority
  public suggestionPriority = atom.config.get("pulsar-typescript").autocompletionSuggestionPriority
  public excludeLowerPriority =
    atom.config.get("pulsar-typescript").autocompletionExcludeLowerPriority

  private lastSuggestions?: {
    // Client used to get the suggestions
    client: TSClient

    // File and position for the suggestions
    location: FileLocationQuery

    // Prefix used
    prefix: string

    // The completions that were returned for the position
    suggestions: SuggestionWithDetails[]
    details: Map<string, Details>
  }

  constructor(private getClient: GetClientFunction, private applyEdits: ApplyEdits) {}

  public async getSuggestions(opts: ACP.SuggestionsRequestedEvent): Promise<ACP.AnySuggestion[]> {
    const location = getLocationQuery(opts)
    const prefix = getPrefix(opts)

    if (!location) return []

    // Don't auto-show autocomplete if prefix is empty unless last character is '.'
    const triggerCharacter = getTrigger(
      getLastNonWhitespaceChar(opts.editor.getBuffer(), opts.bufferPosition),
    )
    if (!prefix && !opts.activatedManually && !triggerCharacter) return []

    // Don't show autocomplete if we're in a string.template and not in a template expression
    if (
      containsScope(opts.scopeDescriptor.getScopesArray(), "string.template.") &&
      !containsScope(opts.scopeDescriptor.getScopesArray(), "template.expression.")
    ) {
      return []
    }

    try {
      let suggestions = await this.getSuggestionsWithCache({
        prefix,
        location,
        triggerCharacter,
        activatedManually: opts.activatedManually,
      })

      const config = atom.config.get("pulsar-typescript")
      if (config.autocompletionUseFuzzyFilter) {
        suggestions = fuzzaldrin.filter(suggestions, prefix, {
          key: "displayText",
        })
      } else {
        const ignoreCase = config.autocompletionStrictFilterIgnoreCase
        const longestFirst = config.autocompletionStrictFilterLongestMatchFirst
        const score = ignoreCase
          ? (text: string) => {
              const pos = text.toLowerCase().indexOf(prefix.toLowerCase())
              const length = text.length * (longestFirst ? -1 : 1)
              const exact = text.includes(prefix) && prefix.toLowerCase() !== prefix ? -10000 : 0
              return 100 * pos + exact + length
            }
          : (text: string) => {
              const pos = text.indexOf(prefix)
              const length = text.length * (longestFirst ? -1 : 1)
              return 100 * pos + length
            }
        const filter = ignoreCase
          ? (val: {displayText?: string}) =>
              val.displayText?.toLowerCase().includes(prefix.toLowerCase())
          : (val: {displayText?: string}) => val.displayText?.includes(prefix)
        suggestions = suggestions
          .filter(filter)
          .sort((a, b) => score(a.displayText!) - score(b.displayText!))
      }

      return suggestions.map((suggestion) => ({
        replacementPrefix: suggestion.replacementRange
          ? opts.editor.getTextInBufferRange(suggestion.replacementRange)
          : prefix,
        location,
        ...this.getDetailsFromCache(suggestion),
        ...addCallableParens(opts, suggestion),
      }))
    } catch (error) {
      return []
    }
  }

  public async getSuggestionDetailsOnSelect(suggestion: ACP.AnySuggestion) {
    if ("text" in suggestion && !("rightLabel" in suggestion)) {
      return this.getAdditionalDetails(suggestion)
    } else {
      return null
    }
  }

  public onDidInsertSuggestion(evt: ACP.SuggestionInsertedEvent) {
    const s = evt.suggestion as SuggestionWithDetails
    if (!s.hasAction) return
    if (!this.lastSuggestions) return
    const client = this.lastSuggestions.client
    const file = this.lastSuggestions.location.file
    let details = this.getDetailsFromCache(s)
    handlePromise(
      (async () => {
        if (!details) details = await this.getAdditionalDetails(s)
        if (!details) return
        const resolved = details.details
        await this.applyEdits(lspWorkspaceEditToFileEdits(additionalEditsAsWorkspaceEdit(resolved)))
        if (!resolved.command) return
        await client.execute("applyCodeActionCommand", {file, command: resolved.command})
      })(),
    )
  }

  private async getAdditionalDetails(suggestion: SuggestionWithDetails) {
    if (suggestion.identifier === undefined) return null
    if (!this.lastSuggestions) return null
    const [details] = await this.lastSuggestions.client.execute("completionEntryDetails", {
      entryNames: [suggestion.identifier],
      ...this.lastSuggestions.location,
    })
    // apparently, details can be undefined
    // tslint:disable-next-line: strict-boolean-expressions
    if (!details) return null
    const rightLabel = details.detail ?? ""
    const description =
      (details.detail ?? "") +
      (details.documentation ? "\n\n" + markupToString(details.documentation) : "")
    this.lastSuggestions.details.set(suggestion.displayText!, {details, rightLabel, description})
    return {
      ...suggestion,
      details,
      rightLabel,
      description,
    }
  }

  private getDetailsFromCache(suggestion: SuggestionWithDetails) {
    if (!this.lastSuggestions) return null
    const d = this.lastSuggestions.details.get(suggestion.displayText!)
    if (!d) return null
    return d
  }

  // Try to reuse the last completions we got from tsserver if they're for the same position.
  private async getSuggestionsWithCache({
    prefix,
    location,
    triggerCharacter,
    activatedManually,
  }: {
    prefix: string
    location: FileLocationQuery
    triggerCharacter?: string
    activatedManually: boolean
  }): Promise<SuggestionWithDetails[]> {
    if (this.lastSuggestions && !activatedManually) {
      const lastLoc = this.lastSuggestions.location
      const lastCol = getNormalizedCol(this.lastSuggestions.prefix, lastLoc.offset)
      const thisCol = getNormalizedCol(prefix, location.offset)

      if (lastLoc.file === location.file && lastLoc.line === location.line && lastCol === thisCol) {
        if (this.lastSuggestions.suggestions.length !== 0) {
          return this.lastSuggestions.suggestions
        }
      }
    }

    const client = await this.getClient(location.file)
    const suggestions = await getSuggestionsInternal({
      client,
      location,
      triggerCharacter: activatedManually ? undefined : triggerCharacter,
    })

    this.lastSuggestions = {
      client,
      location,
      prefix,
      suggestions,
      details: new Map(),
    }

    return suggestions
  }
}

async function getSuggestionsInternal({
  client,
  location,
  triggerCharacter,
}: {
  client: TSClient
  location: FileLocationQuery
  triggerCharacter?: string
}) {
  const completions = await client.execute("completionInfo", {
    includeExternalModuleExports: false,
    includeInsertTextCompletions: true,
    triggerCharacter,
    ...location,
  })
  const items =
    completions === null ? [] : Array.isArray(completions) ? completions : completions.items
  return items.map(completionEntryToSuggestion)
}

function markupToString(doc: string | lsp.MarkupContent): string {
  return typeof doc === "string" ? doc : doc.value
}

function additionalEditsAsWorkspaceEdit(item: lsp.CompletionItem): lsp.WorkspaceEdit | undefined {
  if (!item.additionalTextEdits || item.additionalTextEdits.length === 0) return undefined
  if (!item.data || typeof item.data !== "object" || !("fileName" in item.data)) return undefined
  const uri = `file://${(item.data as {fileName: string}).fileName}`
  return {changes: {[uri]: item.additionalTextEdits}}
}

// this should more or less match ES6 specification for valid identifiers
const identifierMatch =
  /(?:(?![\u{10000}-\u{10FFFF}])[\$_\p{Lu}\p{Ll}\p{Lt}\p{Lm}\p{Lo}\p{Nl}])(?:(?![\u{10000}-\u{10FFFF}])[\$_\p{Lu}\p{Ll}\p{Lt}\p{Lm}\p{Lo}\p{Nl}\u200C\u200D\p{Mn}\p{Mc}\p{Nd}\p{Pc}])*$/u

// Decide what needs to be replaced in the editor buffer when inserting the completion
function getPrefix(opts: ACP.SuggestionsRequestedEvent): string {
  // see https://github.com/TypeStrong/atom-typescript/issues/1528
  // for the motivating example.
  const line = opts.editor
    .getBuffer()
    .getTextInRange([[opts.bufferPosition.row, 0], opts.bufferPosition])
  const idMatch = line.match(identifierMatch)
  if (idMatch) return idMatch[0]
  else return ""
}

// When the user types each character in ".hello", we want to normalize the column such that it's
// the same for every invocation of the getSuggestions. In this case, it would be right after "."
function getNormalizedCol(prefix: string, col: number): number {
  const length = prefix === "." ? 0 : prefix.length
  return col - length
}

function getLocationQuery(opts: ACP.SuggestionsRequestedEvent): FileLocationQuery | undefined {
  const path = opts.editor.getPath()
  if (path === undefined) {
    return undefined
  }
  return {
    file: path,
    line: opts.bufferPosition.row + 1,
    offset: opts.bufferPosition.column + 1,
  }
}

function getLastNonWhitespaceChar(buffer: Atom.TextBuffer, pos: Atom.Point): string | undefined {
  let lastChar: string | undefined
  const range = new Atom.Range([0, 0], pos)
  buffer.backwardsScanInRange(
    /\S/,
    range,
    ({matchText, stop}: {matchText: string; stop: () => void}) => {
      lastChar = matchText
      stop()
    },
  )
  return lastChar
}

function containsScope(scopes: ReadonlyArray<string>, matchScope: string): boolean {
  for (const scope of scopes) {
    if (scope.includes(matchScope)) {
      return true
    }
  }

  return false
}

function completionEntryToSuggestion(entry: lsp.CompletionItem): SuggestionWithDetails {
  const edit = entry.textEdit
  const range = edit ? ("insert" in edit ? edit.replace : edit.range) : undefined
  return {
    displayText: entry.label,
    text: entry.insertText !== undefined ? entry.insertText : entry.label,
    leftLabel: kindLabel[entry.kind ?? 0],
    replacementRange: range ? lspRangeToAtomRangeLocal(range) : undefined,
    type: kindMap[entry.kind ?? 0],
    isMemberCompletion: undefined,
    identifier: entry,
    hasAction: !!(entry.additionalTextEdits?.length || entry.command),
  }
}

function lspRangeToAtomRangeLocal(range: lsp.Range): Atom.Range {
  return new Atom.Range(
    [range.start.line, range.start.character],
    [range.end.line, range.end.character],
  )
}

function parens(opts: ACP.SuggestionsRequestedEvent) {
  const buffer = opts.editor.getBuffer()
  const pt = opts.bufferPosition
  const lookahead = buffer.getTextInRange([pt, [pt.row, buffer.lineLengthForRow(pt.row)]])
  return !!lookahead.match(/\s*\(/)
}

function addCallableParens(
  opts: ACP.SuggestionsRequestedEvent,
  s: SuggestionWithDetails,
): ACP.TextSuggestion | ACP.SnippetSuggestion {
  if (
    atom.config.get("pulsar-typescript.autocompleteParens") &&
    ["function", "method"].includes(s.leftLabel!) &&
    !parens(opts)
  ) {
    return {...s, snippet: `${s.text}($1)`, text: undefined}
  } else return s
}

/** From :
 * https://github.com/atom-community/autocomplete-plus/pull/334#issuecomment-85697409
 */
type ACPCompletionType =
  | "variable"
  | "constant"
  | "property"
  | "value"
  | "method"
  | "function"
  | "class"
  | "type"
  | "keyword"
  | "tag"
  | "import"
  | "require"
  | "snippet"

const kindMap: {[key in lsp.CompletionItemKind | 0]: ACPCompletionType | undefined} = {
  [0]: undefined,
  [CompletionItemKind.Text]: "value",
  [CompletionItemKind.Method]: "method",
  [CompletionItemKind.Function]: "function",
  [CompletionItemKind.Constructor]: "method",
  [CompletionItemKind.Field]: "property",
  [CompletionItemKind.Variable]: "variable",
  [CompletionItemKind.Class]: "class",
  [CompletionItemKind.Interface]: "type",
  [CompletionItemKind.Module]: "import",
  [CompletionItemKind.Property]: "property",
  [CompletionItemKind.Unit]: undefined,
  [CompletionItemKind.Value]: "value",
  [CompletionItemKind.Enum]: "type",
  [CompletionItemKind.Keyword]: "keyword",
  [CompletionItemKind.Snippet]: "snippet",
  [CompletionItemKind.Color]: undefined,
  [CompletionItemKind.File]: "require",
  [CompletionItemKind.Reference]: "import",
  [CompletionItemKind.Folder]: "require",
  [CompletionItemKind.EnumMember]: "constant",
  [CompletionItemKind.Constant]: "constant",
  [CompletionItemKind.Struct]: "class",
  [CompletionItemKind.Event]: undefined,
  [CompletionItemKind.Operator]: undefined,
  [CompletionItemKind.TypeParameter]: "type",
}

const kindLabel: {[key in lsp.CompletionItemKind | 0]: string} = {
  [0]: "",
  [CompletionItemKind.Text]: "text",
  [CompletionItemKind.Method]: "method",
  [CompletionItemKind.Function]: "function",
  [CompletionItemKind.Constructor]: "constructor",
  [CompletionItemKind.Field]: "field",
  [CompletionItemKind.Variable]: "variable",
  [CompletionItemKind.Class]: "class",
  [CompletionItemKind.Interface]: "interface",
  [CompletionItemKind.Module]: "module",
  [CompletionItemKind.Property]: "property",
  [CompletionItemKind.Unit]: "unit",
  [CompletionItemKind.Value]: "value",
  [CompletionItemKind.Enum]: "enum",
  [CompletionItemKind.Keyword]: "keyword",
  [CompletionItemKind.Snippet]: "snippet",
  [CompletionItemKind.Color]: "color",
  [CompletionItemKind.File]: "file",
  [CompletionItemKind.Reference]: "reference",
  [CompletionItemKind.Folder]: "folder",
  [CompletionItemKind.EnumMember]: "enum member",
  [CompletionItemKind.Constant]: "constant",
  [CompletionItemKind.Struct]: "struct",
  [CompletionItemKind.Event]: "event",
  [CompletionItemKind.Operator]: "operator",
  [CompletionItemKind.TypeParameter]: "type parameter",
}

const triggerCharacters = new Set([".", '"', "'", "`", "/", "@", "<", "#"])
function getTrigger(prefix: string | undefined): string | undefined {
  if (prefix === undefined) return undefined
  if (!prefix) return undefined
  const c = prefix.slice(-1)
  if (triggerCharacters.has(c)) {
    return c
  }
  return undefined
}
