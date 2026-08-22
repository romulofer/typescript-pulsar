import {OutlineProvider, OutlineTree, OutlineTreeKind} from "atom-ide-base"
import * as lsp from "vscode-languageserver-protocol"
import {GetClientFunction} from "../../client"
import {lspRangeToAtomRange, typeScriptScopes} from "../atom/utils"

export function getOutlineProvider(getClient: GetClientFunction): OutlineProvider {
  return {
    name: "Atom-TypeScript",
    grammarScopes: typeScriptScopes(),
    priority: 100,
    updateOnEdit: true,
    async getOutline(editor) {
      const filePath = editor.getPath()
      if (filePath === undefined) return
      const client = await getClient(filePath)
      const navTree = await client.execute("navtree", {file: filePath})
      if (!navTree || navTree.length === 0) return
      if (isDocumentSymbols(navTree)) {
        return {outlineTrees: navTree.map(docSymbolToOutline).sort(compareNodes)}
      }
      return {outlineTrees: navTree.map(symbolInfoToOutline).sort(compareNodes)}
    },
  }
}

function isDocumentSymbols(
  symbols: lsp.DocumentSymbol[] | lsp.SymbolInformation[],
): symbols is lsp.DocumentSymbol[] {
  return !("location" in symbols[0])
}

function docSymbolToOutline(sym: lsp.DocumentSymbol): OutlineTree {
  const range = lspRangeToAtomRange(sym.range)
  return {
    kind: kindMap[sym.kind],
    plainText: sym.name,
    startPosition: range.start,
    endPosition: range.end,
    landingPosition: lspRangeToAtomRange(sym.selectionRange).start,
    children: (sym.children ?? []).map(docSymbolToOutline).sort(compareNodes),
  }
}

function symbolInfoToOutline(sym: lsp.SymbolInformation): OutlineTree {
  const range = lspRangeToAtomRange(sym.location.range)
  return {
    kind: kindMap[sym.kind],
    plainText: sym.name,
    startPosition: range.start,
    endPosition: range.end,
    landingPosition: range.start,
    children: [],
  }
}

function compareNodes(a: OutlineTree, b: OutlineTree): number {
  const apos = a.landingPosition ? a.landingPosition : a.startPosition
  const bpos = b.landingPosition ? b.landingPosition : b.startPosition
  return apos.compare(bpos)
}

const kindMap: {[key in lsp.SymbolKind]: OutlineTreeKind | undefined} = {
  [lsp.SymbolKind.File]: "file",
  [lsp.SymbolKind.Module]: "module",
  [lsp.SymbolKind.Namespace]: "module",
  [lsp.SymbolKind.Package]: "module",
  [lsp.SymbolKind.Class]: "class",
  [lsp.SymbolKind.Method]: "method",
  [lsp.SymbolKind.Property]: "property",
  [lsp.SymbolKind.Field]: "field",
  [lsp.SymbolKind.Constructor]: "constructor",
  [lsp.SymbolKind.Enum]: "enum",
  [lsp.SymbolKind.Interface]: "interface",
  [lsp.SymbolKind.Function]: "function",
  [lsp.SymbolKind.Variable]: "variable",
  [lsp.SymbolKind.Constant]: "constant",
  [lsp.SymbolKind.String]: "string",
  [lsp.SymbolKind.Number]: undefined,
  [lsp.SymbolKind.Boolean]: undefined,
  [lsp.SymbolKind.Array]: undefined,
  [lsp.SymbolKind.Object]: undefined,
  [lsp.SymbolKind.Key]: undefined,
  [lsp.SymbolKind.Null]: undefined,
  [lsp.SymbolKind.EnumMember]: "constant",
  [lsp.SymbolKind.Struct]: "class",
  [lsp.SymbolKind.Event]: undefined,
  [lsp.SymbolKind.Operator]: undefined,
  [lsp.SymbolKind.TypeParameter]: undefined,
}
