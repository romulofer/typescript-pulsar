import * as lsp from "vscode-languageserver-protocol"

/** LSP `Hover.contents` bundles the signature and documentation into a single string (unlike the
 * old tsserver protocol, which sent `displayString`/`documentation`/`tags` as separate fields).
 * We can't reliably tell where the signature ends and the docs begin, so the first line (up to
 * the first newline) is treated as code and the rest as plain doc text. */
export async function renderTooltip(
  hover: lsp.Hover | undefined,
  etch: any,
  codeRenderer: (code: string) => Promise<JSX.Element> | JSX.Element,
) {
  if (hover === undefined) return null

  const text = hoverContentsToString(hover.contents)
  const newlineIdx = text.indexOf("\n")
  const code = newlineIdx === -1 ? text : text.slice(0, newlineIdx)
  const rest = newlineIdx === -1 ? "" : text.slice(newlineIdx + 1).trim()

  const docs = rest ? <div className="atom-typescript-datatip-tooltip-doc">{rest}</div> : undefined

  return [await codeRenderer(code), docs].filter((x): x is JSX.Element => x !== undefined)
}

function hoverContentsToString(contents: lsp.Hover["contents"]): string {
  if (typeof contents === "string") return contents
  if (Array.isArray(contents)) {
    return contents.map((c) => (typeof c === "string" ? c : c.value)).join("\n\n")
  }
  return contents.value
}
