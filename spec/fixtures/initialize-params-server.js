// Fake LSP server for spec/client/client.spec.ts. Records the params of the `initialize`
// request it received and answers a custom `test/getLastInitializeParams` request with
// them, so the spec can assert on `rootUri`/`workspaceFolders`.
//
// Regression coverage for: client.ts's `initialize` request used to hardcode
// `rootUri: null` and send no `workspaceFolders`, which is a well-behaved-LSP-client
// correctness bug independent of the handshake-ordering crash covered by
// handshake-order-server.js.
const rpc = require("vscode-jsonrpc/node")

const connection = rpc.createMessageConnection(
  new rpc.StreamMessageReader(process.stdin),
  new rpc.StreamMessageWriter(process.stdout),
)

let lastInitializeParams = null

connection.onRequest("initialize", (params) => {
  lastInitializeParams = params
  return {capabilities: {}}
})
connection.onRequest("shutdown", () => null)
connection.onNotification("exit", () => process.exit(0))

connection.onRequest("test/getLastInitializeParams", () => lastInitializeParams)

connection.onNotification(() => {})
connection.onRequest(() => null)

connection.listen()
