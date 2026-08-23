import {TextEditorElement} from "atom"
import * as etch from "etch"
import type * as lsp from "vscode-languageserver-protocol"
import {adjustElementPosition} from "../tooltips/util"

interface Props extends JSX.Props {
  left: number
  right: number
  top: number
  bottom: number
  sigHelp?: lsp.SignatureHelp
  visibleItem?: number
}

export class TooltipView implements JSX.ElementClass {
  public readonly element!: HTMLDivElement
  public props: Props

  constructor(private parent: TextEditorElement) {
    this.props = {
      left: 0,
      right: 0,
      top: 0,
      bottom: 0,
    }
    etch.initialize(this)
  }

  public async destroy() {
    return etch.destroy(this)
  }

  public async update(props: Partial<Props>) {
    if (
      props.sigHelp?.activeSignature !== undefined &&
      props.sigHelp?.activeSignature !== this.props.sigHelp?.activeSignature
    ) {
      this.props.visibleItem = undefined
    }
    this.props = {...this.props, ...props}
    if (this.props.sigHelp === undefined) {
      this.props.visibleItem = undefined
    } else if (this.props.visibleItem !== undefined) {
      this.props.visibleItem = this.props.visibleItem % this.props.sigHelp.signatures.length
      if (this.props.visibleItem < 0) this.props.visibleItem += this.props.sigHelp.signatures.length
    }
    await etch.update(this)
  }

  public writeAfterUpdate() {
    adjustElementPosition(
      this.element,
      this.parent,
      this.props,
      atom.config.get("typescript-pulsar").sigHelpPosition,
    )
  }

  public render() {
    return (
      <div className="atom-typescript-tooltip tooltip" key={this.sigHelpHash()}>
        <div className="tooltip-inner">{this.tooltipContents()}</div>
      </div>
    )
  }

  private sigHelpHash() {
    if (!this.props.sigHelp) return undefined
    return this.props.sigHelp.signatures.map((s) => s.label).join("|")
  }

  private tooltipContents() {
    if (!this.props.sigHelp) return "…"
    const {sigHelp} = this.props
    const selectedItemIndex = sigHelp.activeSignature ?? 0
    const visibleItem =
      this.props.visibleItem !== undefined ? this.props.visibleItem : selectedItemIndex
    const count = sigHelp.signatures.length
    const classes = ["atom-typescript-tooltip-signature-help"]
    if (count > 1) {
      classes.push("atom-typescript-tooltip-signature-help-changable")
    }
    function className(idx: number) {
      const newclasses = []
      if (idx === selectedItemIndex) {
        newclasses.push("atom-typescript-tooltip-signature-help-selected")
      }
      if (idx === visibleItem) {
        newclasses.push("atom-typescript-tooltip-signature-help-visible")
      }
      return [...classes, ...newclasses].join(" ")
    }
    return sigHelp.signatures.map((sig, idx) => (
      <div className={className(idx)}>
        <div>
          {this.renderLabel(
            sig,
            idx === selectedItemIndex ? sigHelp.activeParameter ?? undefined : undefined,
          )}
          <div className="atom-typescript-tooltip-signature-help-documentation">
            {markupToStr(sig.documentation)}
          </div>
        </div>
      </div>
    ))
  }

  private renderLabel(sig: lsp.SignatureInformation, activeParameter: number | undefined) {
    const param = activeParameter !== undefined ? sig.parameters?.[activeParameter] : undefined
    if (!param || typeof param.label === "string") return sig.label
    const [start, end] = param.label
    return [
      sig.label.slice(0, start),
      <span className="atom-typescript-tooltip-signature-help-selected">
        {sig.label.slice(start, end)}
      </span>,
      sig.label.slice(end),
    ]
  }
}

function markupToStr(doc: string | lsp.MarkupContent | undefined): string {
  if (doc === undefined) return ""
  return typeof doc === "string" ? doc : doc.value
}
