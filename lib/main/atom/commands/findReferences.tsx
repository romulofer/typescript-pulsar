import {TextEditor} from "atom"
import * as etch from "etch"
import * as fs from "fs"
import * as lsp from "vscode-languageserver-protocol"
import {TsView} from "../components/tsView"
import {getFilePathPosition, highlight, lspPositionToLocation, uriToFilePath} from "../utils"
import {HighlightComponent} from "../views/highlightComponent"
import {selectListView} from "../views/simpleSelectionView"
import {addCommand, Dependencies} from "./registry"

addCommand("atom-text-editor", "typescript:find-references", (deps) => ({
  description: "Find where symbol under text cursor is referenced",
  async didDispatch(editor) {
    const location = getFilePathPosition(editor)
    if (!location) return

    const client = await deps.getClient(location.file)
    const result = await client.execute("references", location)
    await handleFindReferencesResult(result, editor, deps.histGoForward)
  },
}))

export async function handleFindReferencesResult(
  result: lsp.Location[] | null,
  editor: TextEditor,
  histGoForward: Dependencies["histGoForward"],
): Promise<void> {
  if (!result) return

  const refs = Promise.all(
    result.map(async (ref) => {
      const file = uriToFilePath(ref.uri)
      const start = lspPositionToLocation(ref.range.start)
      const fileContents = (
        await new Promise<string>((resolve, reject) =>
          fs.readFile(file, (error, data) => {
            if (error) reject(error)
            else resolve(data.toString("utf-8"))
          }),
        )
      ).split(/\r?\n/g)
      const line = fileContents[ref.range.start.line] ?? ""
      const hlText = (await highlight(line, "source.tsx")).split("\n")[0]
      return {file, start, hlText}
    }),
  )

  const res = await selectListView({
    items: refs,
    itemTemplate: (item, ctx) => {
      return (
        <li>
          <HighlightComponent
            label={atom.project.relativize(item.file)}
            query={ctx.getFilterQuery()}
          />
          <div className="pull-right">line: {item.start.line}</div>
          <TsView highlightedText={item.hlText} />
        </li>
      )
    },
    itemFilterKey: "file",
  })
  if (res) await histGoForward(editor, res)
}
