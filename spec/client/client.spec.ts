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
    // symptom the real typescript-go crash had.
    await client.execute("open", {file: "test.ts", fileContent: "const x = 1"})

    // Give the fake server's own message handling a moment to run (and, if there were a
    // violation, to actually exit and for that exit to propagate back to the client).
    await sleep(200)

    expect(terminated).to.equal(false)
  })
})

describe("TypescriptServiceClient initialize params", function () {
  this.timeout(8000)

  const fixturePath = join(__dirname, "..", "fixtures", "initialize-params-server.js")
  let client: TypescriptServiceClient

  afterEach(async () => {
    await client.destroy()
  })

  it("sends a real rootUri and workspaceFolders, not rootUri: null", async () => {
    const projectRootPath = __dirname
    client = new TypescriptServiceClient(
      fixturePath,
      "1.0.0-test",
      projectRootPath,
      (_title, generator) => generator(),
    )

    // Any command is enough to force execute() to await the initialize/initialized
    // handshake before we ask the fake server what it received.
    await client.execute("open", {file: "test.ts", fileContent: "const x = 1"})

    const connection = (client as unknown as ClientWithConnection).connection
    const params = (await connection?.sendRequest("test/getLastInitializeParams")) as {
      rootUri: string | null
      workspaceFolders: Array<{uri: string; name: string}> | null
    }

    // The bug this guards against: initialize used to hardcode rootUri: null and send no
    // workspaceFolders at all, which is a correctness bug for any well-behaved LSP client.
    expect(params.rootUri).to.be.a("string")
    expect(params.rootUri).to.not.equal(null)
    expect(params.workspaceFolders).to.have.lengthOf(1)
    expect(params.workspaceFolders?.[0].uri).to.equal(params.rootUri)
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
    // typescript-go's code fix providers (which only look at diagnostics passed here) never
    // returned anything for any diagnostic, ever.
    expect(context.diagnostics).to.have.lengthOf(1)
    expect(context.diagnostics[0].code).to.equal(2304)
    expect(context.diagnostics[0].message).to.equal("Cannot find name 'greetHelper'.")
  })
})
