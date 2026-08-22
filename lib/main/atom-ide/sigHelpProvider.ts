import {CompositeDisposable, Point, TextEditor} from "atom"
import {SignatureHelp, SignatureHelpProvider} from "atom-ide-base"
import {GetClientFunction} from "../../client"
import {lspSignatureToSignature, typeScriptScopes} from "../atom/utils"

export class TSSigHelpProvider implements SignatureHelpProvider {
  public triggerCharacters = new Set<string>([])
  public grammarScopes = typeScriptScopes()
  public priority = 100
  private disposables = new CompositeDisposable()

  constructor(private getClient: GetClientFunction) {
    const triggerCharsDefault = new Set(["<", "(", ","])
    const triggerCharsDisabled = new Set<string>([])
    this.disposables.add(
      atom.config.observe("pulsar-typescript.sigHelpDisplayOnChange", (newVal) => {
        this.triggerCharacters = newVal ? triggerCharsDefault : triggerCharsDisabled
      }),
    )
  }

  public dispose() {
    this.disposables.dispose()
  }

  public async getSignatureHelp(
    editor: TextEditor,
    pos: Point,
  ): Promise<SignatureHelp | undefined> {
    try {
      const filePath = editor.getPath()
      if (filePath === undefined) return
      const client = await this.getClient(filePath)
      const data = await client.execute("signatureHelp", {
        file: filePath,
        line: pos.row + 1,
        offset: pos.column + 1,
      })
      if (!data) return
      return {
        signatures: data.signatures.map(lspSignatureToSignature),
        activeParameter: data.activeParameter ?? 0,
        activeSignature: data.activeSignature ?? 0,
      }
    } catch (e) {
      return
    }
  }
}
