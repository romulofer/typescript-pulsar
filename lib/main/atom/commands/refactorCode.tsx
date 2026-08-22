import * as etch from "etch"
import * as lsp from "vscode-languageserver-protocol"
import {TSClient} from "../../../client"
import {getFilePathPosition, lspWorkspaceEditToFileEdits, rangeToLocationRange} from "../utils"
import {HighlightComponent} from "../views/highlightComponent"
import {selectListView} from "../views/simpleSelectionView"
import {addCommand, Dependencies} from "./registry"

export interface RefactorAction {
  file: string
  action: lsp.CodeAction
}

addCommand("atom-text-editor", "typescript:refactor-selection", (deps) => ({
  description: "Get a list of applicable refactors to selected code",
  async didDispatch(editor) {
    const location = getFilePathPosition(editor)
    if (!location) return

    const selection = editor.getSelectedBufferRange()
    const client = await deps.getClient(location.file)

    const range = selection.isEmpty()
      ? {
          line: location.line,
          offset: location.offset,
          endLine: location.line,
          endOffset: location.offset,
        }
      : rangeToLocationRange(selection)

    const actions = await getApplicableRefactorsActions(client, {...range, file: location.file})

    if (actions.length === 0) {
      atom.notifications.addInfo("AtomTS: No applicable refactors for the selection")
      return
    }

    const selectedAction = await selectListView({
      items: actions.map((a) => ({...a, title: a.action.title})),
      itemTemplate: (item, ctx) => {
        return (
          <li>
            <HighlightComponent label={item.title} query={ctx.getFilterQuery()} />
          </li>
        )
      },
      itemFilterKey: "title",
    })

    if (selectedAction === undefined) return
    await applyRefactors(selectedAction, client, deps)
  },
}))

export async function getApplicableRefactorsActions(
  client: TSClient,
  range: {file: string; line: number; offset: number; endLine: number; endOffset: number},
): Promise<RefactorAction[]> {
  try {
    const results = await client.execute("getApplicableRefactors", range)
    return results
      .filter((r): r is lsp.CodeAction => "edit" in r || "kind" in r)
      .map((action) => ({file: range.file, action}))
  } catch {
    return []
  }
}

export async function applyRefactors(
  selected: RefactorAction,
  client: TSClient,
  deps: Pick<Dependencies, "applyEdits">,
) {
  const resolved = await client.execute("resolveCodeAction", {
    file: selected.file,
    action: selected.action,
  })

  await deps.applyEdits(lspWorkspaceEditToFileEdits(resolved.edit))
}
