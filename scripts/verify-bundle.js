// Guards against the class of bug fixed in 700b152b: a dynamic require(someVar) or
// require.resolve(someVar) anywhere in dist/main.js. Parcel's electron-renderer
// bundler can't statically resolve those, and silently produces something
// non-callable at runtime instead of erroring at build time (see AGENTS.md's
// "Critical gotcha: no dynamic require() in lib/"). npm run typecheck/build proves
// nothing about this class of bug, since it's a bundler-output problem, not a
// TypeScript-level error - this scans the actual built artifact.
//
// Usage: npm run build && node scripts/verify-bundle.js

const fs = require("fs")
const path = require("path")

const BUNDLE_PATH = path.join(__dirname, "..", "dist", "main.js")

function main() {
  if (!fs.existsSync(BUNDLE_PATH)) {
    console.error(`${BUNDLE_PATH} does not exist - run "npm run build" first`)
    process.exit(1)
  }

  const src = fs.readFileSync(BUNDLE_PATH, "utf8")
  const callRe = /require(\.resolve)?\s*\(/g
  const violations = []
  let m
  while ((m = callRe.exec(src))) {
    const argStart = m.index + m[0].length
    let i = argStart
    while (i < src.length && /\s/.test(src[i])) i++
    const next = src[i]
    const isStringLiteral = next === '"' || next === "'" || next === "`"
    if (!isStringLiteral) {
      const lineNo = src.slice(0, m.index).split("\n").length
      const line = src.split("\n")[lineNo - 1].trim()
      violations.push({lineNo, line})
    }
  }

  if (violations.length > 0) {
    console.error(
      `Found ${violations.length} dynamic require()/require.resolve() call(s) in dist/main.js:`,
    )
    for (const v of violations) console.error(`  dist/main.js:${v.lineNo}: ${v.line}`)
    console.error(
      "\nThese resolve to something non-callable at runtime in the packaged build " +
        "(see AGENTS.md's dynamic-require gotcha). Read a runtime-computed JSON path " +
        "with fs.readFile/JSON.parse, or use the resolve package's resolveModule() " +
        "helper in resolveBinary.ts, instead of require()/require.resolve() with a " +
        "non-literal argument.",
    )
    process.exit(1)
  }

  console.log("OK: no dynamic require()/require.resolve() calls in dist/main.js")
}

main()
