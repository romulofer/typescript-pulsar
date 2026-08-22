import {BufferedNodeProcess, BufferedProcess, Emitter} from "atom"
import {ChildProcess} from "child_process"
import {pathToFileURL} from "url"
import type * as lsp from "vscode-languageserver-protocol"
import * as rpc from "vscode-jsonrpc/node"
import {ReportBusyWhile} from "../main/pluginManager"
import {
  AllTSClientCommands,
  ChangeParams,
  CloseParams,
  CommandArg,
  CommandRes,
  CompletionEntryDetailsParams,
  CompletionsParams,
  ConfigureParams,
  FileLocationQuery,
  FormatParams,
  GetApplicableRefactorsParams,
  GetCodeFixesParams,
  GetEditsForFileRenameParams,
  GetErrParams,
  LocationRangeQuery,
  NavtoParams,
  OpenParams,
  OrganizeImportsParams,
  RenameParams,
  ResolveCodeActionParams,
} from "./commandArgsResponseMap"
import {DiagnosticEventTypes} from "./events"
import {CodeActionKind, CodeActionTriggerKind, CompletionTriggerKind} from "./lspConstants"

// Set this to true to start the LSP server with node --inspect
const INSPECT_TSSERVER = false

/** 1-based tsserver-style line/offset -> 0-based LSP position. */
function toLspPosition(line: number, offset: number): lsp.Position {
  return {line: line - 1, character: offset - 1}
}

function toLspRange(x: LocationRangeQuery): lsp.Range {
  return {
    start: toLspPosition(x.line, x.offset),
    end: toLspPosition(x.endLine, x.endOffset),
  }
}

function fileToUri(file: string): string {
  return pathToFileURL(file).toString()
}

function uriToFile(uri: string): string {
  return new URL(uri).pathname
}

export class TypescriptServiceClient {
  private readonly emitter = new Emitter<
    {
      restarted: void
      terminated: void
    },
    DiagnosticEventTypes
  >()

  private server?: ChildProcess
  private connection?: rpc.MessageConnection
  private lastStderrOutput = ""
  private openFileVersions = new Map<string, number>()

  // tslint:disable-next-line:member-ordering
  public on = this.emitter.on.bind(this.emitter)

  constructor(
    public tsServerPath: string,
    public version: string,
    private reportBusyWhile: ReportBusyWhile,
  ) {
    this.server = this.startServer()
  }

  public async execute<T extends AllTSClientCommands>(
    command: T,
    ...args: CommandArg<T>
  ): Promise<CommandRes<T>> {
    if (!this.connection) {
      this.server = this.startServer()
      this.emitter.emit("restarted")
    }

    if (window.atom_typescript_debug) {
      console.log("sending request", command, args[0])
    }

    return this.reportBusyWhile(command, () => this.dispatch(command, args[0] as any)) as Promise<
      CommandRes<T>
    >
  }

  public async restartServer() {
    await this.stopServer()
    if (!this.connection) {
      this.server = this.startServer()
      this.emitter.emit("restarted")
    }
  }

  public async destroy() {
    const terminated = new Promise<void>((resolve) => {
      const disp = this.emitter.once("terminated", () => {
        this.emitter.dispose()
        disp.dispose()
        resolve()
      })
    })
    return Promise.all([terminated, this.stopServer()])
  }

  private conn(): rpc.MessageConnection {
    if (!this.connection) throw new Error("TS language server connection is not available")
    return this.connection
  }

  // tslint:disable-next-line:cyclomatic-complexity
  private async dispatch(command: AllTSClientCommands, arg: any): Promise<any> {
    const c = this.conn()
    switch (command) {
      case "open": {
        const x = arg as OpenParams
        this.openFileVersions.set(x.file, 1)
        c.sendNotification("textDocument/didOpen", {
          textDocument: {
            uri: fileToUri(x.file),
            languageId: "typescript",
            version: 1,
            text: x.fileContent,
          },
        })
        return
      }
      case "close": {
        const x = arg as CloseParams
        this.openFileVersions.delete(x.file)
        c.sendNotification("textDocument/didClose", {textDocument: {uri: fileToUri(x.file)}})
        return
      }
      case "change": {
        const x = arg as ChangeParams
        const version = (this.openFileVersions.get(x.file) ?? 1) + 1
        this.openFileVersions.set(x.file, version)
        c.sendNotification("textDocument/didChange", {
          textDocument: {uri: fileToUri(x.file), version},
          contentChanges: [{range: toLspRange(x), text: x.insertString}],
        })
        return
      }
      case "configure": {
        const x = arg as ConfigureParams
        c.sendNotification("workspace/didChangeConfiguration", {
          settings: {typescript: {format: x.formatOptions, preferences: x.preferences}},
        })
        return
      }
      case "geterr": {
        const x = arg as GetErrParams
        for (const file of x.files) {
          const report = (await c.sendRequest("textDocument/diagnostic", {
            textDocument: {uri: fileToUri(file)},
          })) as lsp.DocumentDiagnosticReport
          const diagnostics = report.kind === "full" ? report.items : []
          this.emitter.emit("semanticDiag", {file, diagnostics})
        }
        return
      }
      case "quickinfo": {
        const x = arg as FileLocationQuery
        return c.sendRequest("textDocument/hover", {
          textDocument: {uri: fileToUri(x.file)},
          position: toLspPosition(x.line, x.offset),
        })
      }
      case "signatureHelp": {
        const x = arg as FileLocationQuery
        return c.sendRequest("textDocument/signatureHelp", {
          textDocument: {uri: fileToUri(x.file)},
          position: toLspPosition(x.line, x.offset),
        })
      }
      case "definition": {
        const x = arg as FileLocationQuery
        return c.sendRequest("textDocument/definition", {
          textDocument: {uri: fileToUri(x.file)},
          position: toLspPosition(x.line, x.offset),
        })
      }
      case "references": {
        const x = arg as FileLocationQuery
        return c.sendRequest("textDocument/references", {
          textDocument: {uri: fileToUri(x.file)},
          position: toLspPosition(x.line, x.offset),
          context: {includeDeclaration: true},
        })
      }
      case "documentHighlights": {
        const x = arg as FileLocationQuery
        return c.sendRequest("textDocument/documentHighlight", {
          textDocument: {uri: fileToUri(x.file)},
          position: toLspPosition(x.line, x.offset),
        })
      }
      case "navtree": {
        const x = arg as {file: string}
        return c.sendRequest("textDocument/documentSymbol", {
          textDocument: {uri: fileToUri(x.file)},
        })
      }
      case "navto": {
        const x = arg as NavtoParams
        return c.sendRequest("workspace/symbol", {query: x.searchValue})
      }
      case "format": {
        const x = arg as FormatParams
        return c.sendRequest("textDocument/rangeFormatting", {
          textDocument: {uri: fileToUri(x.file)},
          range: toLspRange(x),
          options: {tabSize: 4, insertSpaces: true},
        })
      }
      case "completionInfo":
      case "completions": {
        const x = arg as CompletionsParams
        return c.sendRequest("textDocument/completion", {
          textDocument: {uri: fileToUri(x.file)},
          position: toLspPosition(x.line, x.offset),
          context: x.triggerCharacter
            ? {
                triggerKind: CompletionTriggerKind.TriggerCharacter,
                triggerCharacter: x.triggerCharacter,
              }
            : {triggerKind: CompletionTriggerKind.Invoked},
        })
      }
      case "completionEntryDetails": {
        const x = arg as CompletionEntryDetailsParams
        return Promise.all(
          x.entryNames.map((item) =>
            c.sendRequest("completionItem/resolve", item).catch(() => null),
          ),
        )
      }
      case "applyCodeActionCommand": {
        const x = arg as {file: string; command: lsp.Command}
        return c.sendRequest("workspace/executeCommand", {
          command: x.command.command,
          arguments: x.command.arguments,
        })
      }
      case "getCodeFixes": {
        const x = arg as GetCodeFixesParams
        return c.sendRequest("textDocument/codeAction", {
          textDocument: {uri: fileToUri(x.file)},
          range: toLspRange(x),
          context: {
            diagnostics: [],
            only: ["quickfix"],
            triggerKind: CodeActionTriggerKind.Automatic,
          },
        })
      }
      case "getApplicableRefactors": {
        const x = arg as GetApplicableRefactorsParams
        return c.sendRequest("textDocument/codeAction", {
          textDocument: {uri: fileToUri(x.file)},
          range: toLspRange(x),
          context: {
            diagnostics: [],
            only: ["refactor"],
            triggerKind: CodeActionTriggerKind.Invoked,
          },
        })
      }
      case "resolveCodeAction": {
        const x = arg as ResolveCodeActionParams
        if (x.action.edit) return x.action
        return c.sendRequest("codeAction/resolve", x.action)
      }
      case "organizeImports": {
        const x = arg as OrganizeImportsParams
        const actions = (await c.sendRequest("textDocument/codeAction", {
          textDocument: {uri: fileToUri(x.scope.args.file)},
          range: {start: {line: 0, character: 0}, end: {line: 0, character: 0}},
          context: {
            diagnostics: [],
            only: ["source.organizeImports"],
            triggerKind: CodeActionTriggerKind.Invoked,
          },
        })) as lsp.CodeAction[]
        const edits: lsp.TextEdit[] = []
        for (const a of actions) {
          for (const fileEdits of Object.values(a.edit?.changes ?? {})) {
            edits.push(...fileEdits)
          }
        }
        return edits
      }
      case "prepareRename": {
        const x = arg as FileLocationQuery
        return c.sendRequest("textDocument/prepareRename", {
          textDocument: {uri: fileToUri(x.file)},
          position: toLspPosition(x.line, x.offset),
        })
      }
      case "rename": {
        const x = arg as RenameParams
        return c.sendRequest("textDocument/rename", {
          textDocument: {uri: fileToUri(x.file)},
          position: toLspPosition(x.line, x.offset),
          newName: x.newName,
        })
      }
      case "getEditsForFileRename": {
        const x = arg as GetEditsForFileRenameParams
        return c.sendRequest("workspace/willRenameFiles", {
          files: [{oldUri: fileToUri(x.oldFilePath), newUri: fileToUri(x.newFilePath)}],
        })
      }
      case "projectInfo":
      case "compileOnSaveEmitFile":
      case "compileOnSaveAffectedFileList":
      case "reloadProjects":
        throw new Error(
          `"${command}" has no TypeScript 7 LSP equivalent and is not yet implemented`,
        )
      default:
        throw new Error(`Unknown command: ${command as string}`)
    }
  }

  private async stopServer() {
    if (this.server) {
      const server = this.server
      const graceTimer = setTimeout(() => server.kill(), 10000)
      try {
        if (this.connection) {
          await this.connection.sendRequest("shutdown")
          this.connection.sendNotification("exit")
        }
      } catch (e) {
        // server may already be gone; fall through to the kill timer
      }
      await new Promise<void>((resolve) => {
        const disp = this.emitter.once("terminated", () => {
          disp.dispose()
          resolve()
        })
      })
      clearTimeout(graceTimer)
    }
  }

  private startServer() {
    if (window.atom_typescript_debug) {
      console.log("starting", this.tsServerPath)
    }

    const cp = startServer(this.tsServerPath)
    if (!cp) throw new Error("ChildProcess failed to start")

    const h = this.exitHandler
    cp.once("error", h)
    cp.once("exit", (code: number | null, signal: string | null) => {
      if (code === 0) h(new Error("Server stopped normally"), false)
      else if (code !== null) h(new Error(`exited with code: ${code}`))
      else if (signal !== null) h(new Error(`terminated on signal: ${signal}`))
    })

    if (!cp.stdout) throw new Error("ChildProcess stdout missing")
    if (!cp.stdin) throw new Error("ChildProcess stdin missing")
    if (!cp.stderr) throw new Error("ChildProcess stderr missing")
    cp.stderr.on("data", (data: Buffer) => {
      console.warn("tsc --lsp stderr:", (this.lastStderrOutput = data.toString()))
    })

    const connection = rpc.createMessageConnection(
      new rpc.StreamMessageReader(cp.stdout),
      new rpc.StreamMessageWriter(cp.stdin),
    )
    connection.onNotification(
      "textDocument/publishDiagnostics",
      (params: lsp.PublishDiagnosticsParams) => {
        const file = uriToFile(params.uri)
        const type = /tsconfig(\..+)?\.json$/.test(file) ? "configFileDiag" : "semanticDiag"
        this.emitter.emit(type, {file, diagnostics: params.diagnostics})
      },
    )
    connection.listen()
    this.connection = connection

    const capabilities: lsp.ClientCapabilities = {
      textDocument: {
        documentSymbol: {hierarchicalDocumentSymbolSupport: true},
        codeAction: {
          codeActionLiteralSupport: {
            codeActionKind: {valueSet: Object.values(CodeActionKind)},
          },
          resolveSupport: {properties: ["edit"]},
        },
        rename: {prepareSupport: true},
        completion: {
          completionItem: {resolveSupport: {properties: ["detail", "documentation"]}},
        },
        publishDiagnostics: {relatedInformation: true, tagSupport: {valueSet: [1, 2]}},
      },
      workspace: {applyEdit: true, workspaceEdit: {documentChanges: true}},
    }

    handlePromise(
      connection
        .sendRequest("initialize", {
          processId: process.pid,
          rootUri: null,
          capabilities,
        })
        .then(() => connection.sendNotification("initialized", {})),
    )

    return cp
  }

  private exitHandler = (err: Error, report = true) => {
    this.connection = undefined
    this.server = undefined
    this.emitter.emit("terminated")
    if (report) console.error("tsc --lsp: ", err)

    if (report) {
      let detail = err.message
      if (this.lastStderrOutput) {
        detail = `Last output from tsc --lsp:\n${this.lastStderrOutput}\n\n${detail}`
      }
      atom.notifications.addError("TypeScript server quit unexpectedly", {
        detail,
        stack: err.stack,
        dismissable: true,
      })
    }
  }
}

function startServer(tsServerPath: string): ChildProcess | undefined {
  const tsServerArgs: string[] = ["--lsp", "--stdio"]
  if (INSPECT_TSSERVER) {
    return new BufferedProcess({
      command: "node",
      args: ["--inspect", tsServerPath].concat(tsServerArgs),
    }).process
  } else {
    return new BufferedNodeProcess({
      command: tsServerPath,
      args: tsServerArgs,
    }).process
  }
}

function handlePromise(p: Promise<unknown>) {
  p.catch((e) => console.error(e))
}
