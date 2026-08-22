import {getOpenEditorsPaths} from "../utils"
import {addCommand} from "./registry"

addCommand("atom-text-editor", "typescript:check-all-files", (deps) => ({
  description: "Typecheck all open files related to current active text editor",
  async didDispatch(editor) {
    const file = editor.getPath()
    if (file === undefined) return
    const client = await deps.getClient(file)

    // TypeScript 7's LSP mode has no "list all project files" request (tsserver's projectInfo
    // command has no LSP equivalent), so this checks every currently open editor instead of
    // every file in the project.
    const files = Array.from(getOpenEditorsPaths())
    const max = files.length
    deps.reportProgress({max, value: 0})

    let checked = 0
    const disp = client.on("semanticDiag", () => {
      checked += 1
      deps.reportProgress({max, value: Math.min(checked, max)})
    })

    try {
      await client.execute("geterr", {files, delay: 0})
    } finally {
      disp.dispose()
      deps.reportProgress({max, value: max})
    }
  },
}))
