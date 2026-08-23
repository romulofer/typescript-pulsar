// Fake LSP server for spec/client/client.spec.ts. Stands in for a real `tsc --lsp` process
// but only implements enough of the protocol to catch one thing: a client sending anything
// before the initialize/initialized handshake has completed.
//
// This mirrors a real typescript-go crash: our client used to send its first command
// concurrently with `initialize` instead of after `initialized`, letting a request reach
// typescript-go's server before its session existed and hitting a nil-pointer panic that
// crashed the whole process. A well-behaved client must not send anything else until it
// has received a response to
// `initialize`. Instead of trying to detect that subtly, this fake server does the same
// thing the real server effectively did when it was hit by the bug: it exits with a
// distinctive non-zero code the moment it sees a violation, so the test can just assert the
// client never crashed the "server".
const rpc = require("vscode-jsonrpc/node")

const VIOLATION_EXIT_CODE = 91

const connection = rpc.createMessageConnection(
  new rpc.StreamMessageReader(process.stdin),
  new rpc.StreamMessageWriter(process.stdout),
)

let initializeResponseSent = false

function checkViolation(method) {
  if (!initializeResponseSent) {
    process.stderr.write(`handshake-order-server: violation, received "${method}" before initialize responded\n`)
    process.exit(VIOLATION_EXIT_CODE)
  }
}

connection.onRequest("initialize", () => {
  return new Promise((resolve) => {
    // A real async gap, like the real server's session/project creation, so a client that
    // doesn't wait for this has a real window to race ahead in.
    setTimeout(() => {
      initializeResponseSent = true
      resolve({capabilities: {}})
    }, 30)
  })
})

connection.onRequest("shutdown", () => null)
connection.onNotification("exit", () => process.exit(0))

connection.onNotification((method) => checkViolation(method))
connection.onRequest((method) => {
  checkViolation(method)
  return null
})

connection.listen()
