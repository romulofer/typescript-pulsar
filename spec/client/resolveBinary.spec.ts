import {expect} from "chai"
import {join} from "path"
import {findConfigFile, isLspCapable} from "../../lib/client/resolveBinary"

describe("isLspCapable", () => {
  it("returns true for TypeScript 7+", () => {
    expect(isLspCapable("7.0.0")).to.equal(true)
    expect(isLspCapable("7.0.2")).to.equal(true)
    expect(isLspCapable("8.0.0")).to.equal(true)
    expect(isLspCapable("10.0.0")).to.equal(true)
  })

  it("returns false for TypeScript <7", () => {
    expect(isLspCapable("6.9.0")).to.equal(false)
    expect(isLspCapable("5.0.0")).to.equal(false)
    expect(isLspCapable("4.9.5")).to.equal(false)
    expect(isLspCapable("0.0.0")).to.equal(false)
  })

  it("handles pre-release version strings", () => {
    expect(isLspCapable("7.0.0-beta.1")).to.equal(true)
    expect(isLspCapable("6.0.0-alpha")).to.equal(false)
  })

  it("handles version strings without patch", () => {
    expect(isLspCapable("7.0")).to.equal(true)
    expect(isLspCapable("6.0")).to.equal(false)
  })
})

describe("findConfigFile", () => {
  // The package root has a tsconfig.json; walking up from any spec file should find it.
  const packageRoot = join(__dirname, "..", "..")

  it("finds tsconfig.json by walking up from a source file", async () => {
    const result = await findConfigFile(join(__dirname, "fake-file.ts"))
    expect(result).to.equal(join(packageRoot, "lib", "tsconfig.json"))
  })

  it("returns undefined when no tsconfig.json exists above the given path", async () => {
    // Start from filesystem root — no tsconfig.json should be found
    const result = await findConfigFile("/nonexistent-path/fake.ts")
    expect(result).to.equal(undefined)
  })
})
