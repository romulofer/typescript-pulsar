import {CodeHighlightProvider} from "atom-ide-base"
import {GetClientFunction} from "../../client"
import {
  getFilePathPosition,
  isTypescriptEditorWithPath,
  lspRangeToAtomRange,
  typeScriptScopes,
} from "../atom/utils"

export function getCodeHighlightProvider(getClient: GetClientFunction): CodeHighlightProvider {
  return {
    grammarScopes: typeScriptScopes(),
    priority: 100,
    async highlight(editor, position) {
      if (!isTypescriptEditorWithPath(editor)) return
      const location = getFilePathPosition(editor, position)
      if (!location) return
      const client = await getClient(location.file)
      const result = await client.execute("documentHighlights", location)
      if (!result) return
      return result.map((hl) => lspRangeToAtomRange(hl.range))
    },
  }
}
