import {getFilePathPosition, lspWorkspaceEditToFileEdits} from "../utils"
import {showRenameDialog} from "../views/renameView"
import {addCommand} from "./registry"

addCommand("atom-text-editor", "typescript:rename-refactor", (deps) => ({
  description: "Rename symbol under text cursor everywhere it is used",
  async didDispatch(editor) {
    const location = getFilePathPosition(editor)
    if (!location) return

    const client = await deps.getClient(location.file)
    const prepared = await client.execute("prepareRename", location)

    if (!prepared) {
      atom.notifications.addInfo("AtomTS: Rename not available at cursor location")
      return
    }

    const placeholder = "placeholder" in prepared ? prepared.placeholder : undefined

    const newName = await showRenameDialog({
      autoSelect: true,
      title: "Rename Variable",
      text: placeholder ?? editor.getTextInBufferRange(editor.getSelectedBufferRange()) ?? "",
      onValidate: (newText): string => {
        if (newText.replace(/\s/g, "") !== newText.trim()) {
          return "The new variable must not contain a space"
        }
        if (!newText.trim()) {
          return "If you want to abort : Press esc to exit"
        }
        return ""
      },
    })

    if (newName === undefined) return

    const edit = await client.execute("rename", {...location, newName})
    await deps.applyEdits(lspWorkspaceEditToFileEdits(edit))
  },
}))
