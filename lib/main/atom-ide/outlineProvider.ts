import {OutlineProvider, OutlineTree, OutlineTreeKind} from "atom-ide-base"
import type * as lsp from "vscode-languageserver-protocol"
import {GetClientFunction} from "../../client"
import {SymbolKind} from "../../client/lspConstants"
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
  [SymbolKind.File]: "file",
  [SymbolKind.Module]: "module",
  [SymbolKind.Namespace]: "module",
  [SymbolKind.Package]: "module",
  [SymbolKind.Class]: "class",
  [SymbolKind.Method]: "method",
  [SymbolKind.Property]: "property",
  [SymbolKind.Field]: "field",
  [SymbolKind.Constructor]: "constructor",
  [SymbolKind.Enum]: "enum",
  [SymbolKind.Interface]: "interface",
  [SymbolKind.Function]: "function",
  [SymbolKind.Variable]: "variable",
  [SymbolKind.Constant]: "constant",
  [SymbolKind.String]: "string",
  [SymbolKind.Number]: undefined,
  [SymbolKind.Boolean]: undefined,
  [SymbolKind.Array]: undefined,
  [SymbolKind.Object]: undefined,
  [SymbolKind.Key]: undefined,
  [SymbolKind.Null]: undefined,
  [SymbolKind.EnumMember]: "constant",
  [SymbolKind.Struct]: "class",
  [SymbolKind.Event]: undefined,
  [SymbolKind.Operator]: undefined,
  [SymbolKind.TypeParameter]: undefined,
}
