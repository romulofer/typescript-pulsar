import {expect} from "chai"
import {join} from "path"

const packagePath = join(__dirname, "..")

describe("typescript-pulsar", function () {
  this.timeout(8000)

  it("should activate", async () => {
    const packages = atom.packages

    // Load package, but it won't activate until the TypeScript grammar is used
    const promise = atom.packages.activatePackage(packagePath)

    packages.triggerActivationHook("language-typescript:grammar-used")
    packages.triggerDeferredActivationHooks()

    await promise

    expect(atom.packages.isPackageActive("typescript-pulsar")).to.equal(true)
  })
})
