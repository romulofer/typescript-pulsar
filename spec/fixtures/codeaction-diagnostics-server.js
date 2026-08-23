// Fake LSP server for spec/client/client.spec.ts. Records the `context.diagnostics` array
// from the last `textDocument/codeAction` request it received, and answers a custom
// `test/getLastCodeActionContext` request with it so the spec can assert on it.
//
// Regression coverage for: client.ts's "getCodeFixes" case used to always send
// `context.diagnostics: []`, which is why code actions never returned anything -
// typescript-go's code fix providers only look at diagnostics passed in the request, they
// don't have a server-side diagnostic cache to fall back on.
const rpc = require("vscode-jsonrpc/node")

const connection = rpc.createMessageConnection(
  new rpc.StreamMessageReader(process.stdin),
  new rpc.StreamMessageWriter(process.stdout),
)

let lastCodeActionContext = null

connection.onRequest("initialize", () => ({capabilities: {}}))
connection.onRequest("shutdown", () => null)
connection.onNotification("exit", () => process.exit(0))

connection.onRequest("textDocument/codeAction", (params) => {
  lastCodeActionContext = params.context
  return []
})

connection.onRequest("test/getLastCodeActionContext", () => lastCodeActionContext)

connection.onNotification(() => {})
connection.onRequest(() => null)

connection.listen()
