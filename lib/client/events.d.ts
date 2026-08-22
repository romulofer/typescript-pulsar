import type * as lsp from "vscode-languageserver-protocol"

/** Diagnostics pulled via `textDocument/diagnostic` ("semanticDiag") or pushed by the server for
 * files outside the editor's control, such as tsconfig.json itself ("configFileDiag"). LSP has no
 * syntax/semantic/suggestion distinction the way the old tsserver protocol did. */
export interface DiagnosticEventBody {
  file: string
  diagnostics: lsp.Diagnostic[]
}

export type DiagnosticEventTypes = {
  semanticDiag: DiagnosticEventBody
  configFileDiag: DiagnosticEventBody
}
