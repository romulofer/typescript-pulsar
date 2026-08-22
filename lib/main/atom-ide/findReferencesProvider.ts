import {FindReferencesProvider, Reference} from "atom-ide-base"
import type * as lsp from "vscode-languageserver-protocol"
import {GetClientFunction} from "../../client"
import {getFilePathPosition, isTypescriptEditorWithPath, lspRangeToAtomRange} from "../atom/utils"

export function getFindReferencesProvider(getClient: GetClientFunction): FindReferencesProvider {
  return {
    async isEditorSupported(editor) {
      return isTypescriptEditorWithPath(editor)
    },
    async findReferences(editor, position) {
      const location = getFilePathPosition(editor, position)
      if (!location) return

      const client = await getClient(location.file)
      const result = await client.execute("references", location)
      if (!result) return
      return {
        type: "data",
        baseUri: location.file,
        referencedSymbolName: "",
        references: result.map(refToIde),
      }
    },
  }
}

function refToIde(ref: lsp.Location): Reference {
  return {
    uri: new URL(ref.uri).pathname,
    range: lspRangeToAtomRange(ref.range),
    name: undefined,
  }
}
