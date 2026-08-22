import * as lsp from "vscode-languageserver-protocol"
import {symbolsToNavTree} from "../outline/navTreeUtils"
import {NavigationTreeViewModel} from "../outline/semanticViewModel"
import {Deps} from "./deps"
import {Tag} from "./symbolsTag"

export async function generateFile(filePath: string, deps: Deps) {
  const navtree = await getNavTree(filePath, deps)
  return Array.from(parseNavTree(navtree))
}

export async function generateProject(filePath: string, search: string, deps: Deps) {
  const symbols = await getNavTo(filePath, search, deps)
  if (symbols) {
    return Array.from(parseNavTo(symbols))
  } else return []
}

function* parseNavTree(navTree: NavigationTreeViewModel[], parent?: Tag): IterableIterator<Tag> {
  navTree.sort((a, b) => a.spans[0].start.line - b.spans[0].start.line)
  for (const item of navTree) {
    const tag = Tag.fromNavTree(item, parent)
    yield tag
    if (item.childItems) yield* parseNavTree(item.childItems, tag)
  }
}

function* parseNavTo(symbols: Array<lsp.SymbolInformation | lsp.WorkspaceSymbol>) {
  for (const item of symbols) {
    yield Tag.fromWorkspaceSymbol(item)
  }
}

async function getNavTree(filePath: string, deps: Deps) {
  try {
    const client = await deps.getClient(filePath)
    const symbols = await client.execute("navtree", {file: filePath})
    return symbols ? symbolsToNavTree(symbols) : []
  } catch (e) {
    console.error(filePath, e)
    return []
  }
}

async function getNavTo(filePath: string, search: string, deps: Deps) {
  try {
    const client = await deps.getClient(filePath)
    const navtoResult = await client.execute("navto", {
      file: filePath,
      searchValue: search,
      maxResultCount: 1000,
    })
    return navtoResult
  } catch (e) {
    console.error(filePath, e)
  }
}
