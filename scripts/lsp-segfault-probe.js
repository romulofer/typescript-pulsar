// Standalone repro attempt for the typescript-go segfault documented in REWORK.md
// ("Open issue: tsc --lsp (typescript-go) can segfault"). Talks to `tsc --lsp --stdio`
// directly via vscode-jsonrpc, bypassing Atom/Pulsar entirely, so it can run with
// plain `node scripts/lsp-segfault-probe.js`.
//
// Status as of this run: replays the exact request/notification sequence captured
// live from the real editor (didOpen -> documentSymbol + diagnostic pull, ~1-6ms
// apart -> didChangeConfiguration, all with no artificial delay) and did NOT crash
// in 45 combined attempts (15 synchronous + 30 with realistic ms-level staggering).
// The real editor crashed 3/3 times with the same request sequence. So the trigger
// needs something this probe doesn't yet replicate: more concurrent request types,
// something specific to Electron's BufferedNodeProcess IPC vs a plain Node
// child_process pipe, or session-restore state. See REWORK.md for the full narrative
// and the captured stack trace.

const {spawn} = require("child_process")
const path = require("path")
const fs = require("fs")
const os = require("os")
const rpc = require("vscode-jsonrpc/node")

const TSC_BIN = path.join(__dirname, "..", "node_modules", ".bin", "tsc")

function makeFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lsp-segfault-fixture-"))
  fs.writeFileSync(
    path.join(dir, "tsconfig.json"),
    JSON.stringify({compilerOptions: {target: "es2020", module: "commonjs"}, include: ["**/*"]}),
  )
  const filePath = path.join(dir, "test.ts")
  fs.writeFileSync(
    filePath,
    'function greet(name: string): string {\n  return "hello " + name\n}\ngreet(1)\n',
  )
  return {dir, filePath}
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

async function oneRun(n, {dir, filePath}) {
  const fileUri = "file://" + filePath
  const text = fs.readFileSync(filePath, "utf8")

  const proc = spawn(TSC_BIN, ["--lsp", "--stdio"], {cwd: dir})
  let crashed = false
  proc.stderr.on("data", (d) => {
    const s = d.toString()
    if (s.includes("panic")) crashed = true
    console.error(`[run ${n}] STDERR:`, s.slice(0, 300))
  })
  proc.on("exit", (code) => {
    if (code !== 0) crashed = true
  })

  const connection = rpc.createMessageConnection(
    new rpc.StreamMessageReader(proc.stdout),
    new rpc.StreamMessageWriter(proc.stdin),
  )
  connection.listen()

  await connection.sendRequest("initialize", {
    processId: process.pid,
    rootUri: "file://" + dir,
    workspaceFolders: [{uri: "file://" + dir, name: path.basename(dir)}],
    capabilities: {
      textDocument: {
        documentSymbol: {hierarchicalDocumentSymbolSupport: true},
        codeAction: {
          codeActionLiteralSupport: {codeActionKind: {valueSet: []}},
          resolveSupport: {properties: ["edit"]},
        },
        rename: {prepareSupport: true},
        completion: {completionItem: {resolveSupport: {properties: ["detail", "documentation"]}}},
        publishDiagnostics: {relatedInformation: true, tagSupport: {valueSet: [1, 2]}},
      },
      workspace: {applyEdit: true, workspaceEdit: {documentChanges: true}},
    },
  })
  connection.sendNotification("initialized", {})

  connection.sendNotification("textDocument/didOpen", {
    textDocument: {uri: fileUri, languageId: "typescript", version: 1, text},
  })

  const pending = []
  pending.push(
    connection
      .sendRequest("textDocument/documentSymbol", {textDocument: {uri: fileUri}})
      .catch(() => {}),
  )
  await sleep(1)
  pending.push(
    connection
      .sendRequest("textDocument/diagnostic", {textDocument: {uri: fileUri}})
      .catch(() => {}),
  )
  await sleep(5)
  connection.sendNotification("workspace/didChangeConfiguration", {
    settings: {
      typescript: {
        format: {indentSize: 2, tabSize: 2},
        preferences: {
          includeCompletionsWithInsertText: true,
          includeCompletionsForModuleExports: false,
          quotePreference: "auto",
          importModuleSpecifierEnding: "auto",
        },
      },
    },
  })

  await Promise.allSettled(pending)
  await sleep(300)

  if (!crashed && proc.exitCode === null) proc.kill()
  return crashed
}

// Decoupled-controllers variant. The linear `oneRun` above sends requests from a
// single script in a fixed order with artificial sleeps between them. The real
// addon isn't one script: TypescriptBuffer.open() (didOpen -> unawaited geterr ->
// real fs lookup for tsconfig.json -> didChangeConfiguration) and the Outline
// panel's getOutline() (independent getClient() -> documentSymbol) are two
// *separate* consumers of the same pooled client, triggered off the same
// "active editor changed" event, with zero cross-awaiting between them. This
// fires both "controllers" from the same synchronous tick and lets real
// `fs.promises.access` I/O (not a fixed sleep) drive the timing gap before
// didChangeConfiguration, so the interleaving is whatever the event loop
// actually produces rather than a hand-picked stagger.
async function oneRunDecoupled(n, {dir, filePath}) {
  const fileUri = "file://" + filePath
  const text = fs.readFileSync(filePath, "utf8")
  const tsconfigPath = path.join(dir, "tsconfig.json")

  const proc = spawn(TSC_BIN, ["--lsp", "--stdio"], {cwd: dir})
  let crashed = false
  proc.stderr.on("data", (d) => {
    const s = d.toString()
    if (s.includes("panic")) crashed = true
    console.error(`[decoupled ${n}] STDERR:`, s.slice(0, 300))
  })
  proc.on("exit", (code) => {
    if (code !== 0) crashed = true
  })

  const connection = rpc.createMessageConnection(
    new rpc.StreamMessageReader(proc.stdout),
    new rpc.StreamMessageWriter(proc.stdin),
  )
  connection.listen()

  await connection.sendRequest("initialize", {
    processId: process.pid,
    rootUri: "file://" + dir,
    workspaceFolders: [{uri: "file://" + dir, name: path.basename(dir)}],
    capabilities: {
      textDocument: {
        documentSymbol: {hierarchicalDocumentSymbolSupport: true},
        codeAction: {
          codeActionLiteralSupport: {codeActionKind: {valueSet: []}},
          resolveSupport: {properties: ["edit"]},
        },
        rename: {prepareSupport: true},
        completion: {completionItem: {resolveSupport: {properties: ["detail", "documentation"]}}},
        publishDiagnostics: {relatedInformation: true, tagSupport: {valueSet: [1, 2]}},
      },
      workspace: {applyEdit: true, workspaceEdit: {documentChanges: true}},
    },
  })
  connection.sendNotification("initialized", {})

  const pending = []

  // Controller A: TypescriptBuffer.open() -> init() -> readConfigFile(), same
  // shape as typescriptBuffer.ts (open awaited, geterr fire-and-forget, real
  // fs walk before configure).
  const controllerA = (async () => {
    connection.sendNotification("textDocument/didOpen", {
      textDocument: {uri: fileUri, languageId: "typescript", version: 1, text},
    })
    pending.push(
      connection
        .sendRequest("textDocument/diagnostic", {textDocument: {uri: fileUri}})
        .catch(() => {}),
    )
    await fs.promises.access(tsconfigPath).catch(() => {})
    connection.sendNotification("workspace/didChangeConfiguration", {
      settings: {
        typescript: {
          format: {indentSize: 2, tabSize: 2},
          preferences: {
            includeCompletionsWithInsertText: true,
            includeCompletionsForModuleExports: false,
            quotePreference: "auto",
            importModuleSpecifierEnding: "auto",
          },
        },
      },
    })
  })()

  // Controller B: Outline panel's getOutline(), entirely independent of A.
  const controllerB = (async () => {
    pending.push(
      connection
        .sendRequest("textDocument/documentSymbol", {textDocument: {uri: fileUri}})
        .catch(() => {}),
    )
  })()

  // Controller C: occurrence highlighting on initial cursor position (0,0),
  // same "fires off the active-editor-changed event, no dependency on A/B".
  const controllerC = (async () => {
    pending.push(
      connection
        .sendRequest("textDocument/documentHighlight", {
          textDocument: {uri: fileUri},
          position: {line: 0, character: 0},
        })
        .catch(() => {}),
    )
  })()

  await Promise.allSettled([controllerA, controllerB, controllerC, ...pending])
  await sleep(300)

  if (!crashed && proc.exitCode === null) proc.kill()
  return crashed
}

async function main() {
  const mode = process.argv[2] === "decoupled" ? "decoupled" : "linear"
  const n = Number(process.argv[3]) || (mode === "decoupled" ? 30 : 15)
  const fixture = makeFixture()
  let crashCount = 0
  for (let i = 1; i <= n; i++) {
    const crashed =
      mode === "decoupled" ? await oneRunDecoupled(i, fixture) : await oneRun(i, fixture)
    if (crashed) crashCount++
    console.log(`run ${i}: ${crashed ? "CRASHED" : "ok"}`)
  }
  fs.rmSync(fixture.dir, {recursive: true, force: true})
  console.log(`\n[${mode}] ${crashCount}/${n} runs crashed`)
}

main()
