// atom-select-list's package.json doesn't declare "atom" anywhere (dependencies/peerDependencies/
// engines), even though its code does `require("atom")`. Modern Parcel (bundling with
// isLibrary:true) refuses to treat "atom" as external unless the *requiring* package's own
// package.json declares it — so without this, the build fails. Patch it in after every install.
const fs = require("fs")
const path = require("path")

const pkgPath = path.join(__dirname, "..", "node_modules", "atom-select-list", "package.json")
if (fs.existsSync(pkgPath)) {
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"))
  pkg.engines = pkg.engines || {}
  if (pkg.engines.atom === undefined) {
    pkg.engines.atom = "*"
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n")
  }
}
