import {Definition, DefinitionProvider} from "atom-ide-base"
import {GetClientFunction} from "../../client"
import {
  getFilePathPosition,
  isTypescriptEditorWithPath,
  normalizeLocations,
  typeScriptScopes,
} from "../atom/utils"

export function getDefinitionProvider(getClient: GetClientFunction): DefinitionProvider {
  return {
    name: "typescript-pulsar",
    priority: 0,
    grammarScopes: typeScriptScopes(),
    wordRegExp: /([A-Za-z0-9_])+|['"`](\\.|[^'"`\\\\])*['"`]/g,
    async getDefinition(editor, position) {
      if (!isTypescriptEditorWithPath(editor)) return
      const location = getFilePathPosition(editor, position)
      if (!location) return
      const client = await getClient(location.file)
      const result = await client.execute("definition", location)
      const locations = normalizeLocations(result)
      if (locations.length === 0) return

      return {
        queryRange: undefined,
        definitions: locations.map(
          (loc): Definition => ({
            path: loc.file,
            position: loc.range.start,
            range: loc.range,
            language: "TypeScript",
          }),
        ),
      }
    },
  }
}
