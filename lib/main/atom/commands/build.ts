import {addCommand} from "./registry"

addCommand("atom-text-editor", "typescript:build", (deps) => ({
  description: "Compile all files in project related to current active text editor",
  async didDispatch(editor) {
    const file = editor.getPath()
    if (file === undefined) return

    // TypeScript 7's LSP mode has no "emit" or "list project files" request (tsserver's
    // projectInfo/compileOnSaveEmitFile commands have no LSP equivalent). Shelling out to
    // `tsc -p` directly is the planned replacement; not yet implemented.
    deps.reportBuildStatus({
      success: false,
      message: "Build is not yet supported on TypeScript 7 (LSP) — use `tsc -p` directly for now.",
    })
  },
}))
