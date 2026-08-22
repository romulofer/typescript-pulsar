import type * as lsp from "vscode-languageserver-protocol"
import {symbolKindNames} from "../outline/navTreeUtils"
import {NavigationTreeViewModel} from "../outline/semanticViewModel"

export class Tag {
  public static fromNavTree(navTree: NavigationTreeViewModel, parent?: Tag | null) {
    const start = navTree.spans[0].start
    return new Tag({
      name: navTree.text,
      type: navTree.kind,
      position: {row: start.line - 1, column: start.offset - 1},
      parent: parent != null ? parent : null,
    })
  }

  public static fromWorkspaceSymbol(
    sym: lsp.SymbolInformation | lsp.WorkspaceSymbol,
    parent?: Tag | null,
  ) {
    const location = sym.location
    const range = "range" in location ? location.range : undefined
    const start = range
      ? {row: range.start.line, column: range.start.character}
      : {row: 0, column: 0}
    return new Tag({
      name: sym.name,
      type: symbolKindNames[sym.kind],
      position: start,
      parent: parent != null ? parent : null,
      file: new URL(location.uri).pathname,
    })
  }

  public position: {row: number; column: number}
  public name: string
  public type: string
  public parent: Tag | null
  public file?: string

  private constructor(props: {
    position: {row: number; column: number}
    name: string
    type: string
    parent: Tag | null
    file?: string
  }) {
    this.position = props.position
    this.name = props.name
    this.type = props.type
    this.parent = props.parent
    this.file = props.file
  }
}
