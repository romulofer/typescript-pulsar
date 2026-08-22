import {TextEditor} from "atom"
import * as etch from "etch"
import type * as lsp from "vscode-languageserver-protocol"
import {getFilePathPosition, normalizeLocations, pointToLocation} from "../utils"
import {HighlightComponent} from "../views/highlightComponent"
import {selectListView} from "../views/simpleSelectionView"
import {addCommand, Dependencies} from "./registry"

addCommand("atom-text-editor", "typescript:go-to-declaration", (deps) => ({
  description: "Go to declaration of symbol under text cursor",
  async didDispatch(editor) {
    const location = getFilePathPosition(editor)
    if (!location) return

    const client = await deps.getClient(location.file)
    const result = await client.execute("definition", location)
    await handleDefinitionResult(result, editor, deps.histGoForward)
  },
}))

export async function handleDefinitionResult(
  result: lsp.Location | lsp.Location[] | lsp.LocationLink[] | null,
  editor: TextEditor,
  histGoForward: Dependencies["histGoForward"],
): Promise<void> {
  const locations = normalizeLocations(result).map((loc) => ({
    file: loc.file,
    start: pointToLocation(loc.range.start),
  }))

  if (locations.length === 0) {
    return
  } else if (locations.length > 1) {
    const res = await selectListView({
      items: locations,
      itemTemplate: (item, ctx) => {
        return (
          <li>
            <HighlightComponent label={item.file} query={ctx.getFilterQuery()} />
            <div className="pull-right">line: {item.start.line}</div>
          </li>
        )
      },
      itemFilterKey: "file",
    })
    if (res) await histGoForward(editor, res)
  } else {
    await histGoForward(editor, locations[0])
  }
}
