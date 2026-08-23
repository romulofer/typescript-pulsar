import {CompositeDisposable, Emitter} from "atom"
import * as path from "path"
import type * as lsp from "vscode-languageserver-protocol"
import {ReportBusyWhile} from "../main/pluginManager"
import {handlePromise} from "../utils"
import {TypescriptServiceClient as Client} from "./client"
import {DiagnosticEventBody} from "./events"
import {DiagnosticSeverity, DiagnosticTag, getDiagnosticMessageString} from "./lspConstants"
import {findConfigFile, resolveBinary} from "./resolveBinary"

export type DiagnosticTypes = "semanticDiag" | "configFileDiag"

/** Old tsserver-protocol-shaped diagnostic (1-based line/offset). `errorPusher.ts` and the rest
 * of the UI are written against this shape, so LSP `Diagnostic`s are converted to it here, at the
 * single point where they enter the app. */
export interface Diagnostic {
  start: {line: number; offset: number}
  end: {line: number; offset: number}
  text: string
  code?: number | string
  category: "error" | "warning" | "suggestion" | "message"
  reportsUnnecessary?: boolean
}

interface DiagnosticsPayload {
  diagnostics: Diagnostic[]
  filePath: string
  serverPath: string
  type: DiagnosticTypes
}

export interface EventTypes {
  diagnostics: DiagnosticsPayload
}

/**
 * ClientResolver takes care of finding the correct tsc (LSP mode) for a source file based on how
 * a require("typescript") from the same source file would resolve.
 */
export class ClientResolver {
  private clients = new Map<string, Map<string | undefined, Client>>()
  private memoizedClients = new Map<string, Promise<Client>>()
  // Atom's Emitter<OptionalEmissions, ...> uses {} to mean "no optional emissions beyond EventTypes".
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  private emitter = new Emitter<{}, EventTypes>()
  private subscriptions = new CompositeDisposable()
  private tsserverInstancePerTsconfig =
    atom.config.get("pulsar-typescript").tsserverInstancePerTsconfig
  // This is just here so TypeScript can infer the types of the callbacks when using "on" method
  // tslint:disable-next-line:member-ordering
  public on = this.emitter.on.bind(this.emitter)

  constructor(private reportBusyWhile: ReportBusyWhile) {}

  public async restartAllServers() {
    await this.reportBusyWhile("Restarting servers", () =>
      Promise.all(Array.from(this.getAllClients()).map((client) => client.restartServer())),
    )
  }

  public async get(pFilePath: string): Promise<Client> {
    const memo = this.memoizedClients.get(pFilePath)
    if (memo) return memo
    const client = this._get(pFilePath)
    this.memoizedClients.set(pFilePath, client)
    try {
      return await client
    } catch (e) {
      this.memoizedClients.delete(pFilePath)
      throw e
    }
  }

  public dispose() {
    this.emitter.dispose()
    this.subscriptions.dispose()
    this.memoizedClients.clear()
    for (const tsconfigMap of this.clients.values()) {
      for (const client of tsconfigMap.values()) {
        handlePromise(client.destroy())
      }
    }
    this.clients.clear()
  }

  private async _get(pFilePath: string): Promise<Client> {
    const {pathToBin, version} = await resolveBinary(pFilePath)
    const configFile = await findConfigFile(pFilePath)
    const tsconfigPath = this.tsserverInstancePerTsconfig ? configFile : undefined
    const projectRootPath =
      configFile !== undefined ? path.dirname(configFile) : path.dirname(pFilePath)

    let tsconfigMap = this.clients.get(pathToBin)
    if (!tsconfigMap) {
      tsconfigMap = new Map()
      this.clients.set(pathToBin, tsconfigMap)
    }
    const client = tsconfigMap.get(tsconfigPath)
    if (client) return client

    const newClient = new Client(pathToBin, version, projectRootPath, this.reportBusyWhile)
    tsconfigMap.set(tsconfigPath, newClient)

    this.subscriptions.add(
      newClient.on("configFileDiag", this.diagnosticHandler(pathToBin, "configFileDiag")),
      newClient.on("semanticDiag", this.diagnosticHandler(pathToBin, "semanticDiag")),
    )

    return newClient
  }

  private *getAllClients() {
    for (const tsconfigMap of this.clients.values()) {
      yield* tsconfigMap.values()
    }
  }

  private diagnosticHandler =
    (serverPath: string, type: DiagnosticTypes) => (result: DiagnosticEventBody) => {
      this.emitter.emit("diagnostics", {
        type,
        serverPath,
        filePath: result.file,
        diagnostics: result.diagnostics.map(lspDiagnosticToDiagnostic),
      })
    }
}

export function lspDiagnosticToDiagnostic(d: lsp.Diagnostic): Diagnostic {
  return {
    start: {line: d.range.start.line + 1, offset: d.range.start.character + 1},
    end: {line: d.range.end.line + 1, offset: d.range.end.character + 1},
    text: getDiagnosticMessageString(d.message),
    code: d.code,
    category: severityToCategory(d.severity),
    reportsUnnecessary: d.tags?.includes(DiagnosticTag.Unnecessary),
  }
}

export function severityToCategory(
  severity: lsp.DiagnosticSeverity | undefined,
): Diagnostic["category"] {
  switch (severity) {
    case DiagnosticSeverity.Error:
      return "error"
    case DiagnosticSeverity.Warning:
      return "warning"
    case DiagnosticSeverity.Hint:
      return "suggestion"
    default:
      return "message"
  }
}
