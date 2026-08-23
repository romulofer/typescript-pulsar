import {expect} from "chai"
import {join} from "path"
import type * as rpc from "vscode-jsonrpc/node"
import {TypescriptServiceClient} from "../../lib/client/client"

// TypescriptServiceClient has no public API for sending an arbitrary custom request (nor
// should it), so this test reaches into the private `connection` field. `private` is
// compile-time only, so this works at runtime; the cast just gives it a real type instead of
// falling through to `any`.
interface ClientWithConnection {
  connection?: rpc.MessageConnection
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

describe("TypescriptServiceClient handshake ordering", function () {
  this.timeout(8000)

  const fixturePath = join(__dirname, "..", "fixtures", "handshake-order-server.js")
  let client: TypescriptServiceClient

  afterEach(async () => {
    await client.destroy()
  })

  it("does not send anything to the server before initialize responds", async () => {
    let terminated = false
    client = new TypescriptServiceClient(
      fixturePath,
      "1.0.0-test",
      __dirname,
      (_title, generator) => generator(),
    )
    client.on("terminated", () => {
      terminated = true
    })

    // Triggers startServer() and, per the LSP spec, must not reach the fake server before
    // its initialize response does. If it does, handshake-order-server.js exits immediately
    // with a distinctive code, and the client surfaces that as "terminated" - the same
    // symptom the real typescript-go crash (see REWORK.md) had.
    await client.execute("open", {file: "test.ts", fileContent: "const x = 1"})

    // Give the fake server's own message handling a moment to run (and, if there were a
    // violation, to actually exit and for that exit to propagate back to the client).
    await sleep(200)

    expect(terminated).to.equal(false)
  })
})

describe("TypescriptServiceClient getCodeFixes", function () {
  this.timeout(8000)

  const fixturePath = join(__dirname, "..", "fixtures", "codeaction-diagnostics-server.js")
  let client: TypescriptServiceClient

  afterEach(async () => {
    await client.destroy()
  })

  it("sends the fixable diagnostic in context.diagnostics, not an empty array", async () => {
    client = new TypescriptServiceClient(
      fixturePath,
      "1.0.0-test",
      __dirname,
      (_title, generator) => generator(),
    )

    await client.execute("getCodeFixes", {
      file: "test.ts",
      line: 1,
      offset: 13,
      endLine: 1,
      endOffset: 24,
      errorCodes: [2304],
      diagnosticMessage: "Cannot find name 'greetHelper'.",
    })

    const connection = (client as unknown as ClientWithConnection).connection
    const context = (await connection?.sendRequest("test/getLastCodeActionContext")) as {
      diagnostics: Array<{code: number; message: string}>
    }

    // The bug this guards against: context.diagnostics used to always be [], which is why
    // typescript-go's code fix providers (which only look at diagnostics passed here, see
    // REWORK.md) never returned anything for any diagnostic, ever.
    expect(context.diagnostics).to.have.lengthOf(1)
    expect(context.diagnostics[0].code).to.equal(2304)
    expect(context.diagnostics[0].message).to.equal("Cannot find name 'greetHelper'.")
  })
})
