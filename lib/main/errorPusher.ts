import {ConfigValues, Point, Range} from "atom"
import {IndieDelegate, Message} from "atom/linter"
import {debounce} from "lodash"
import * as path from "path"
import {Diagnostic, DiagnosticTypes} from "../client/clientResolver"
import {locationsToRange, spanToRange} from "./atom/utils"

/** Class that collects errors from all of the clients and pushes them to the Linter service */
export class ErrorPusher {
  private linter?: IndieDelegate
  private errors = new Map<DiagnosticTypes, Map<string, Diagnostic[]>>()
  private fileGrammars = new Map<string, string>()

  constructor() {
    this.pushErrors = debounce(this.pushErrors.bind(this), 100)
  }

  public *getErrorsInRange(filePath: string, range: Range): IterableIterator<Diagnostic> {
    for (const prefixed of this.errors.values()) {
      const errors = prefixed.get(path.normalize(filePath))
      if (errors) yield* errors.filter((err) => spanToRange(err).intersectsWith(range))
    }
  }

  /** Return any errors that cover the given location */
  public *getErrorsAt(filePath: string, loc: Point): IterableIterator<Diagnostic> {
    for (const prefixed of this.errors.values()) {
      const errors = prefixed.get(path.normalize(filePath))
      if (errors) yield* errors.filter((err) => spanToRange(err).containsPoint(loc))
    }
  }

  /** Set errors. Previous errors with the same prefix and filePath are going to be replaced */
  public setErrors(prefix: DiagnosticTypes, filePath: string, errors: Diagnostic[]) {
    let prefixed = this.errors.get(prefix)
    if (!prefixed) {
      prefixed = new Map()
      this.errors.set(prefix, prefixed)
    }

    prefixed.set(path.normalize(filePath), errors)

    this.pushErrors()
  }

  public clearFileErrors(filePath: string) {
    for (const map of this.errors.values()) {
      map.delete(filePath)
    }
    this.pushErrors()
  }

  public clear() {
    if (!this.linter) return
    this.linter.clearMessages()
  }

  public setLinter(linter: IndieDelegate) {
    this.linter = linter
    this.pushErrors()
  }

  public dispose() {
    this.clear()
    if (this.linter) this.linter.dispose()
    this.linter = undefined
  }

  private pushErrors() {
    if (this.linter) this.linter.setAllMessages(this.getLinterErrors())
  }

  private getLinterErrors(): Message[] {
    if (atom.config.get("typescript-pulsar.suppressAllDiagnostics")) return []
    const result: Message[] = []
    for (const fileErrors of this.errors.values()) {
      for (const [filePath, diagnostics] of fileErrors) {
        const ed = atom.workspace.getTextEditors().find((x) => x.getPath() === filePath)
        const scopeName = ed ? ed.getGrammar().scopeName : this.selectGrammar(filePath)
        if (config("suppressAllDiagnostics", scopeName)) continue
        for (const diagnostic of diagnostics) {
          if (config("ignoredDiagnosticCodes", scopeName).includes(`${diagnostic.code}`)) continue
          if (
            config("ignoreUnusedSuggestionDiagnostics", scopeName) &&
            diagnostic.reportsUnnecessary
          ) {
            continue
          }
          if (
            diagnostic.category === "suggestion" &&
            config("ignoredSuggestionDiagnostics", scopeName).includes(`${diagnostic.code}`)
          ) {
            continue
          }
          // Add a bit of extra validation that we have the necessary locations since linter v2
          // does not allow range-less messages anymore. This happens with configFileDiagnostics.
          let {start, end} = diagnostic as Partial<Diagnostic>
          if (!start || !end) {
            start = end = {line: 1, offset: 1}
          }

          result.push({
            severity: this.getSeverity(config("unusedAsInfo", scopeName), diagnostic),
            excerpt: diagnostic.text,
            location: {
              file: filePath,
              position: locationsToRange(start, end),
            },
          })
        }
      }
    }

    return result
  }

  private selectGrammar(filePath: string): string {
    const knownGramamr = this.fileGrammars.get(filePath)
    if (knownGramamr !== undefined) return knownGramamr
    const selectedGrammar = atom.grammars.selectGrammar(filePath, "").scopeName
    this.fileGrammars.set(filePath, selectedGrammar)
    return selectedGrammar
  }

  private getSeverity(unusedAsInfo: boolean, diagnostic: Diagnostic) {
    if (unusedAsInfo && diagnostic.code === 6133) return "info"
    switch (diagnostic.category) {
      case "error":
        return "error"
      case "warning":
        return "warning"
      default:
        return "info"
    }
  }
}

function config<T extends keyof ConfigValues["typescript-pulsar"]>(
  option: T,
  scope: string,
): ConfigValues["typescript-pulsar"][typeof option] {
  // atom.config.get<T>'s T is inferred from a literal keyPath; a template-literal keyPath like
  // this one can't be matched against `keyof ConfigValues`, so TS can't verify the result
  // against our own declared return type on its own.
  return atom.config.get(`typescript-pulsar.${option}`, {
    scope: [scope],
  }) as unknown as ConfigValues["typescript-pulsar"][typeof option]
}
