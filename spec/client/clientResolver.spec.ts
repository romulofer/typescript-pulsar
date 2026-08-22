import {expect} from "chai"
import * as lsp from "vscode-languageserver-protocol"
import {lspDiagnosticToDiagnostic, severityToCategory} from "../../lib/client/clientResolver"

describe("clientResolver diagnostic conversion", () => {
  describe("lspDiagnosticToDiagnostic", () => {
    it("converts 0-based LSP range to 1-based start/end", () => {
      const d: lsp.Diagnostic = {
        range: {start: {line: 4, character: 2}, end: {line: 4, character: 10}},
        message: "Type 'string' is not assignable to type 'number'.",
        severity: lsp.DiagnosticSeverity.Error,
        code: 2322,
      }
      const result = lspDiagnosticToDiagnostic(d)
      expect(result.start).to.deep.equal({line: 5, offset: 3})
      expect(result.end).to.deep.equal({line: 5, offset: 11})
    })

    it("extracts a plain string message", () => {
      const d: lsp.Diagnostic = {
        range: {start: {line: 0, character: 0}, end: {line: 0, character: 1}},
        message: "Cannot find name 'x'.",
      }
      expect(lspDiagnosticToDiagnostic(d).text).to.equal("Cannot find name 'x'.")
    })

    it("carries the diagnostic code through unchanged", () => {
      const d: lsp.Diagnostic = {
        range: {start: {line: 0, character: 0}, end: {line: 0, character: 1}},
        message: "msg",
        code: 6133,
      }
      expect(lspDiagnosticToDiagnostic(d).code).to.equal(6133)
    })

    it("flags reportsUnnecessary when the Unnecessary tag is present", () => {
      const d: lsp.Diagnostic = {
        range: {start: {line: 0, character: 0}, end: {line: 0, character: 1}},
        message: "'x' is declared but never used.",
        tags: [lsp.DiagnosticTag.Unnecessary],
      }
      expect(lspDiagnosticToDiagnostic(d).reportsUnnecessary).to.equal(true)
    })

    it("leaves reportsUnnecessary undefined when there are no tags", () => {
      const d: lsp.Diagnostic = {
        range: {start: {line: 0, character: 0}, end: {line: 0, character: 1}},
        message: "msg",
      }
      expect(lspDiagnosticToDiagnostic(d).reportsUnnecessary).to.equal(undefined)
    })
  })

  describe("severityToCategory", () => {
    it("maps Error to 'error'", () => {
      expect(severityToCategory(lsp.DiagnosticSeverity.Error)).to.equal("error")
    })

    it("maps Warning to 'warning'", () => {
      expect(severityToCategory(lsp.DiagnosticSeverity.Warning)).to.equal("warning")
    })

    it("maps Hint to 'suggestion'", () => {
      expect(severityToCategory(lsp.DiagnosticSeverity.Hint)).to.equal("suggestion")
    })

    it("maps Information and undefined to 'message'", () => {
      expect(severityToCategory(lsp.DiagnosticSeverity.Information)).to.equal("message")
      expect(severityToCategory(undefined)).to.equal("message")
    })
  })
})
