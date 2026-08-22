import * as Atom from "atom"
import * as lsp from "vscode-languageserver-protocol"
import {ClientResolver} from "../../../client"
import {ErrorPusher} from "../../errorPusher"
import {ApplyEdits} from "../../pluginManager"
import {getApplicableRefactorsActions, RefactorAction} from "../commands/refactorCode"
import {lspWorkspaceEditToFileEdits, pointToLocation, spanToRange} from "../utils"

export interface CodeFixAction {
  file: string
  action: lsp.CodeAction | lsp.Command
}

export class CodefixProvider {
  constructor(
    private clientResolver: ClientResolver,
    private errorPusher: ErrorPusher,
    private applyEdits: ApplyEdits,
  ) {}

  public async getFixableRanges(textEditor: Atom.TextEditor, range: Atom.Range) {
    const filePath = textEditor.getPath()
    if (filePath === undefined) return []
    const errors = this.errorPusher.getErrorsInRange(filePath, range)
    return Array.from(errors).map((error) => spanToRange(error))
  }

  public async runCodeFix(
    textEditor: Atom.TextEditor,
    bufferPosition: Atom.Point,
  ): Promise<Array<CodeFixAction | RefactorAction>> {
    const filePath = textEditor.getPath()

    if (filePath === undefined) return []

    const client = await this.clientResolver.get(filePath)

    const requests = Array.from(this.errorPusher.getErrorsAt(filePath, bufferPosition))
      .filter((error) => error.code !== undefined)
      .map((error) =>
        client.execute("getCodeFixes", {
          file: filePath,
          line: error.start.line,
          offset: error.start.offset,
          endLine: error.end.line,
          endOffset: error.end.offset,
          errorCodes: [error.code!].map((c) => (typeof c === "string" ? parseInt(c, 10) : c)),
        }),
      )

    const fixes = await Promise.all(requests)
    const results: CodeFixAction[] = []

    for (const result of fixes) {
      for (const fix of result) {
        results.push({file: filePath, action: fix})
      }
    }

    const refactors = await getApplicableRefactorsActions(client, {
      file: filePath,
      ...pointToLocation(bufferPosition),
      endLine: bufferPosition.row + 1,
      endOffset: bufferPosition.column + 1,
    })

    return [...results, ...refactors]
  }

  public async applyFix(fix: CodeFixAction | RefactorAction) {
    const client = await this.clientResolver.get(fix.file)
    const action = fix.action
    if (isCodeAction(action)) {
      const resolved = action.edit
        ? action
        : await client.execute("resolveCodeAction", {file: fix.file, action})
      await this.applyEdits(lspWorkspaceEditToFileEdits(resolved.edit))
      if (resolved.command) {
        await client.execute("applyCodeActionCommand", {file: fix.file, command: resolved.command})
      }
    } else {
      await client.execute("applyCodeActionCommand", {file: fix.file, command: action})
    }
  }

  public dispose() {
    // NOOP
  }
}

function isCodeAction(action: lsp.CodeAction | lsp.Command): action is lsp.CodeAction {
  return typeof (action as lsp.Command).command !== "string"
}
