/**
 * `vscode-languageserver-protocol` is used only for TYPES throughout this codebase (that import
 * is fully erased at build time). These are its handful of numeric/string constants that we need
 * at runtime, copied out so the plugin bundle never has to actually resolve/bundle that package.
 * Values are part of the stable, versioned LSP spec and don't change.
 */

export const DiagnosticSeverity = {
  Error: 1,
  Warning: 2,
  Information: 3,
  Hint: 4,
} as const

export const DiagnosticTag = {
  Unnecessary: 1,
  Deprecated: 2,
} as const

export const CodeActionKind = {
  Empty: "",
  QuickFix: "quickfix",
  Refactor: "refactor",
  RefactorExtract: "refactor.extract",
  RefactorInline: "refactor.inline",
  RefactorMove: "refactor.move",
  RefactorRewrite: "refactor.rewrite",
  Source: "source",
  SourceOrganizeImports: "source.organizeImports",
  SourceFixAll: "source.fixAll",
  Notebook: "notebook",
} as const

export const CodeActionTriggerKind = {
  Invoked: 1,
  Automatic: 2,
} as const

export const CompletionTriggerKind = {
  Invoked: 1,
  TriggerCharacter: 2,
  TriggerForIncompleteCompletions: 3,
} as const

export const CompletionItemKind = {
  Text: 1,
  Method: 2,
  Function: 3,
  Constructor: 4,
  Field: 5,
  Variable: 6,
  Class: 7,
  Interface: 8,
  Module: 9,
  Property: 10,
  Unit: 11,
  Value: 12,
  Enum: 13,
  Keyword: 14,
  Snippet: 15,
  Color: 16,
  File: 17,
  Reference: 18,
  Folder: 19,
  EnumMember: 20,
  Constant: 21,
  Struct: 22,
  Event: 23,
  Operator: 24,
  TypeParameter: 25,
} as const

export const SymbolKind = {
  File: 1,
  Module: 2,
  Namespace: 3,
  Package: 4,
  Class: 5,
  Method: 6,
  Property: 7,
  Field: 8,
  Constructor: 9,
  Enum: 10,
  Interface: 11,
  Function: 12,
  Variable: 13,
  Constant: 14,
  String: 15,
  Number: 16,
  Boolean: 17,
  Array: 18,
  Object: 19,
  Key: 20,
  Null: 21,
  EnumMember: 22,
  Struct: 23,
  Event: 24,
  Operator: 25,
  TypeParameter: 26,
} as const

/** Reimplements `Diagnostic.getMessageString`: `message` is `string | MarkupContent` since LSP
 * 3.17; return the plain string either way. */
export function getDiagnosticMessageString(message: string | {value: string}): string {
  return typeof message === "string" ? message : message.value
}
