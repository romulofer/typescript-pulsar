import * as Atom from "atom"
import {Datatip, DatatipProvider} from "atom-ide-base"
import {GetClientFunction} from "../../client"
import {renderTooltip} from "../atom/tooltips/tooltipRenderer"
import {highlight, lspRangeToAtomRange, typeScriptScopes} from "../atom/utils"

// Note: a horrible hack to avoid dependency on React
const REACT_ELEMENT_SYMBOL = Symbol.for("react.element")
const etch = {
  dom(type: string, props: any, ...children: any[]): any {
    if (children.length > 0) {
      return {
        $$typeof: REACT_ELEMENT_SYMBOL,
        type,
        ref: null,
        props: {...props, children},
      }
    } else {
      return {
        $$typeof: REACT_ELEMENT_SYMBOL,
        type,
        ref: null,
        props: {...props},
      }
    }
  },
}

export class TSDatatipProvider implements DatatipProvider {
  public readonly providerName = "TypeScript type tooltips"
  public readonly priority = 100
  public readonly grammarScopes = typeScriptScopes()

  constructor(private getClient: GetClientFunction) {}

  public async datatip(
    editor: Atom.TextEditor,
    bufferPt: Atom.Point,
  ): Promise<Datatip | undefined> {
    try {
      const filePath = editor.getPath()
      if (filePath === undefined) return
      const client = await this.getClient(filePath)
      const data = await client.execute("quickinfo", {
        file: filePath,
        line: bufferPt.row + 1,
        offset: bufferPt.column + 1,
      })
      if (!data) return
      const tooltip = await renderTooltip(data, etch, highlightCode)
      return {
        component: () => <div className="atom-typescript-datatip-tooltip">{tooltip}</div>,
        range: data.range
          ? lspRangeToAtomRange(data.range)
          : Atom.Range.fromObject([bufferPt, bufferPt]),
      }
    } catch (e) {
      return
    }
  }
}

async function highlightCode(code: string) {
  const fontFamily = atom.config.get("editor.fontFamily")

  const html = await highlight(code.replace(/\r?\n$/, ""), "source.ts")
  return (
    <div
      style={{fontFamily}}
      className="atom-typescript-datatip-tooltip-code"
      dangerouslySetInnerHTML={{__html: html}}
    />
  )
}
