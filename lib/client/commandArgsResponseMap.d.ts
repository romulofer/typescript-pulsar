import type * as lsp from "vscode-languageserver-protocol"

/**
 * Args/response shapes for the client's `execute()` shim. Command *names* are kept from the old
 * tsserver protocol (so consumers barely change), but since TypeScript 7 removed
 * `typescript/lib/protocol` entirely, args/response *shapes* are now LSP-based.
 */

export interface FileLocationQuery {
  file: string
  /** 1-based */
  line: number
  /** 1-based */
  offset: number
}

export interface LocationRangeQuery {
  file: string
  /** 1-based */
  line: number
  /** 1-based */
  offset: number
  endLine: number
  endOffset: number
}

export interface OpenParams {
  file: string
  fileContent: string
}

export interface CloseParams {
  file: string
}

export interface ChangeParams extends LocationRangeQuery {
  insertString: string
}

export interface ConfigureParams {
  file: string
  formatOptions?: Record<string, unknown>
  preferences?: Record<string, unknown>
}

export interface GetErrParams {
  files: ReadonlyArray<string>
  delay: number
}

export interface FormatParams extends LocationRangeQuery {}

export interface CompletionsParams extends FileLocationQuery {
  prefix?: string
  includeExternalModuleExports?: boolean
  includeInsertTextCompletions?: boolean
  triggerCharacter?: string
}

export interface CompletionEntryDetailsParams extends FileLocationQuery {
  entryNames: ReadonlyArray<lsp.CompletionItem>
}

export interface ApplyCodeActionCommandParams {
  file: string
  command: lsp.Command
}

export interface GetCodeFixesParams extends LocationRangeQuery {
  errorCodes: ReadonlyArray<number>
}

export interface GetApplicableRefactorsParams extends LocationRangeQuery {}

export interface ResolveCodeActionParams {
  file: string
  action: lsp.CodeAction
}

export interface OrganizeImportsParams {
  scope: {type: "file"; args: {file: string}}
}

export interface RenameParams extends FileLocationQuery {
  /** LSP resolves rename edits server-side, so (unlike the old tsserver "rename" command,
   * which just located occurrences) the new name must be supplied upfront. */
  newName: string
}

export interface GetEditsForFileRenameParams {
  oldFilePath: string
  newFilePath: string
}

export interface NavtoParams {
  searchValue: string
  file: string
  maxResultCount?: number
}

export interface CommandArgResponseMap {
  open: (x: OpenParams) => void
  close: (x: CloseParams) => void
  change: (x: ChangeParams) => void
  configure: (x: ConfigureParams) => void
  geterr: (x: GetErrParams) => void

  quickinfo: (x: FileLocationQuery) => lsp.Hover | null
  signatureHelp: (x: FileLocationQuery) => lsp.SignatureHelp | null
  definition: (x: FileLocationQuery) => lsp.Location | lsp.Location[] | lsp.LocationLink[] | null
  references: (x: FileLocationQuery) => lsp.Location[] | null
  documentHighlights: (x: FileLocationQuery) => lsp.DocumentHighlight[] | null
  navtree: (x: {file: string}) => lsp.DocumentSymbol[] | lsp.SymbolInformation[] | null
  navto: (x: NavtoParams) => lsp.WorkspaceSymbol[] | lsp.SymbolInformation[] | null
  format: (x: FormatParams) => lsp.TextEdit[] | null

  completionInfo: (x: CompletionsParams) => lsp.CompletionItem[] | lsp.CompletionList | null
  completions: (x: CompletionsParams) => lsp.CompletionItem[] | lsp.CompletionList | null
  completionEntryDetails: (x: CompletionEntryDetailsParams) => Array<lsp.CompletionItem | null>
  applyCodeActionCommand: (x: ApplyCodeActionCommandParams) => void

  getCodeFixes: (x: GetCodeFixesParams) => Array<lsp.CodeAction | lsp.Command>
  getApplicableRefactors: (x: GetApplicableRefactorsParams) => Array<lsp.CodeAction | lsp.Command>
  /** Resolves a `CodeAction`'s `edit` (and `command`) if the server didn't already include them
   * in the initial `getCodeFixes`/`getApplicableRefactors` response. */
  resolveCodeAction: (x: ResolveCodeActionParams) => lsp.CodeAction
  organizeImports: (x: OrganizeImportsParams) => lsp.TextEdit[]
  prepareRename: (
    x: FileLocationQuery,
  ) => lsp.Range | {range: lsp.Range; placeholder: string} | null
  rename: (x: RenameParams) => lsp.WorkspaceEdit | null

  getEditsForFileRename: (x: GetEditsForFileRenameParams) => lsp.WorkspaceEdit | null

  /** No LSP equivalent (TypeScript 7 dropped the classic tsserver protocol these relied on).
   * Deferred: see plan step 4. Throws at runtime if called. */
  projectInfo: (x: {file: string; needFileNameList: boolean}) => never
  compileOnSaveEmitFile: (x: {file: string}) => never
  compileOnSaveAffectedFileList: (x: {file: string}) => never
  reloadProjects: () => never
}

export type AllTSClientCommands = keyof CommandArgResponseMap

export type CommandsWithResponse = {
  [K in AllTSClientCommands]: CommandRes<K> extends void ? never : K
}[AllTSClientCommands]

export type ArgType<T extends (x: any) => any> = T extends (...x: infer U) => any ? U : never

export type CommandArg<T extends AllTSClientCommands> = ArgType<CommandArgResponseMap[T]>
export type CommandRes<T extends AllTSClientCommands> = ReturnType<CommandArgResponseMap[T]>
