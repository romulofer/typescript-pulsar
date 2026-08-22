import {TextSpan} from "../../utils"

/**
 * View model for the built-in "semantic view" outline panel, built from an LSP
 * `DocumentSymbol`/`SymbolInformation`. Spans use the app's internal 1-based `TextSpan`
 * convention (see `lspRangeToSpan`), not raw LSP 0-based ranges.
 */
export interface NavigationTreeViewModel {
  text: string
  kind: string
  kindModifiers?: string
  spans: TextSpan[]
  nameSpan?: TextSpan
  childItems?: NavigationTreeViewModel[]
  /**
   * indicates if a node (whith children) should be rendered
   * expanded or collapsed.
   * @default undefined (i.e. expanded)
   */
  collapsed: boolean | undefined
}

export interface ToNodeScrollableEditor {
  /**
   * Scroll the editor to line/column that corresponds to the starting-position
   * of the node.
   *
   * @param {NavigationTreeViewModel} node the node to which to scroll the editor
   */
  gotoNode(node: NavigationTreeViewModel): void
}

export interface SelectableNode {
  getSelectedNode(): HTMLElement | undefined
}
