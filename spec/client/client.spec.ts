import {expect} from "chai"
import {join} from "path"
import {TypescriptServiceClient} from "../../lib/client/client"

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
