import * as Atom from "atom"
import {expect} from "chai"
import * as lsp from "vscode-languageserver-protocol"
import {
  locationToLspPosition,
  locationToPoint,
  lspPositionToLocation,
  lspRangeToAtomRange,
  lspRangeToSpan,
  lspTextEditToCodeEdit,
  lspWorkspaceEditToFileEdits,
  normalizeLocations,
  pointToLocation,
  rangeToLocationRange,
} from "../../../../lib/main/atom/utils"

describe("LSP <-> internal coordinate conversions", () => {
  it("pointToLocation / locationToPoint round-trip (0-based <-> 1-based)", () => {
    const point = new Atom.Point(4, 10)
    const location = pointToLocation(point)
    expect(location).to.deep.equal({line: 5, offset: 11})
    expect(locationToPoint(location).isEqual(point)).to.equal(true)
  })

  it("lspPositionToLocation / locationToLspPosition round-trip", () => {
    const position: lsp.Position = {line: 4, character: 10}
    const location = lspPositionToLocation(position)
    expect(location).to.deep.equal({line: 5, offset: 11})
    expect(locationToLspPosition(location)).to.deep.equal(position)
  })

  it("lspRangeToSpan converts both endpoints", () => {
    const range: lsp.Range = {start: {line: 0, character: 0}, end: {line: 2, character: 3}}
    expect(lspRangeToSpan(range)).to.deep.equal({
      start: {line: 1, offset: 1},
      end: {line: 3, offset: 4},
    })
  })

  it("lspTextEditToCodeEdit keeps newText alongside the converted span", () => {
    const edit: lsp.TextEdit = {
      range: {start: {line: 0, character: 0}, end: {line: 0, character: 5}},
      newText: "hello",
    }
    expect(lspTextEditToCodeEdit(edit)).to.deep.equal({
      start: {line: 1, offset: 1},
      end: {line: 1, offset: 6},
      newText: "hello",
    })
  })

  it("lspRangeToAtomRange maps 0-based LSP coordinates directly onto Atom.Range", () => {
    const range: lsp.Range = {start: {line: 1, character: 2}, end: {line: 3, character: 4}}
    const atomRange = lspRangeToAtomRange(range)
    expect(atomRange.start.row).to.equal(1)
    expect(atomRange.start.column).to.equal(2)
    expect(atomRange.end.row).to.equal(3)
    expect(atomRange.end.column).to.equal(4)
  })

  it("rangeToLocationRange converts an Atom.Range back to 1-based line/offset", () => {
    const range = new Atom.Range([1, 2], [3, 4])
    expect(rangeToLocationRange(range)).to.deep.equal({
      line: 2,
      offset: 3,
      endLine: 4,
      endOffset: 5,
    })
  })
})

describe("normalizeLocations", () => {
  const loc = (line: number): lsp.Location => ({
    uri: "file:///a.ts",
    range: {start: {line, character: 0}, end: {line, character: 1}},
  })

  it("returns an empty array for null/undefined", () => {
    expect(normalizeLocations(null)).to.deep.equal([])
    expect(normalizeLocations(undefined)).to.deep.equal([])
  })

  it("wraps a single Location in an array", () => {
    const result = normalizeLocations(loc(3))
    expect(result).to.have.length(1)
    expect(result[0].file).to.equal("/a.ts")
    expect(result[0].range.start.row).to.equal(3)
  })

  it("passes through a Location[] unchanged in count", () => {
    const result = normalizeLocations([loc(1), loc(2)])
    expect(result).to.have.length(2)
    expect(result.map((r) => r.range.start.row)).to.deep.equal([1, 2])
  })

  it("reads targetUri/targetRange off LocationLink entries", () => {
    const link: lsp.LocationLink = {
      targetUri: "file:///b.ts",
      targetRange: {start: {line: 5, character: 0}, end: {line: 5, character: 1}},
      targetSelectionRange: {start: {line: 5, character: 0}, end: {line: 5, character: 1}},
    }
    const result = normalizeLocations([link])
    expect(result).to.have.length(1)
    expect(result[0].file).to.equal("/b.ts")
    expect(result[0].range.start.row).to.equal(5)
  })
})

describe("lspWorkspaceEditToFileEdits", () => {
  it("returns an empty array for null/undefined", () => {
    expect(lspWorkspaceEditToFileEdits(null)).to.deep.equal([])
    expect(lspWorkspaceEditToFileEdits(undefined)).to.deep.equal([])
  })

  it("flattens the 'changes' form (uri -> TextEdit[])", () => {
    const edit: lsp.WorkspaceEdit = {
      changes: {
        "file:///a.ts": [
          {
            range: {start: {line: 0, character: 0}, end: {line: 0, character: 3}},
            newText: "foo",
          },
        ],
      },
    }
    const result = lspWorkspaceEditToFileEdits(edit)
    expect(result).to.have.length(1)
    expect(result[0].fileName).to.equal("/a.ts")
    expect(result[0].textChanges).to.deep.equal([
      {start: {line: 1, offset: 1}, end: {line: 1, offset: 4}, newText: "foo"},
    ])
  })

  it("flattens the 'documentChanges' form (TextDocumentEdit[])", () => {
    const edit: lsp.WorkspaceEdit = {
      documentChanges: [
        {
          textDocument: {uri: "file:///a.ts", version: null},
          edits: [
            {
              range: {start: {line: 1, character: 0}, end: {line: 1, character: 2}},
              newText: "bar",
            },
          ],
        },
      ],
    }
    const result = lspWorkspaceEditToFileEdits(edit)
    expect(result).to.have.length(1)
    expect(result[0].fileName).to.equal("/a.ts")
    expect(result[0].textChanges[0].newText).to.equal("bar")
  })

  it("skips resource operations (CreateFile/RenameFile/DeleteFile) in documentChanges", () => {
    const edit: lsp.WorkspaceEdit = {
      documentChanges: [{kind: "create", uri: "file:///new.ts"}],
    }
    expect(lspWorkspaceEditToFileEdits(edit)).to.deep.equal([])
  })
})
