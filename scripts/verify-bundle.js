// Guards against two classes of bug that only show up in the built artifact, not at the
// TypeScript-source level, so npm run typecheck/build alone proves nothing about them:
//
// 1. (fixed in 700b152b) A dynamic require(someVar) or require.resolve(someVar) anywhere
//    in dist/main.js. Parcel's electron-renderer bundler can't statically resolve those,
//    and silently produces something non-callable at runtime instead of erroring at
//    build time (see AGENTS.md's "Critical gotcha: no dynamic require() in lib/").
// 2. (fixed in 8ccc6b45) A React.createElement(...) call anywhere in dist/main.js. This
//    package uses etch (jsxFactory: "etch.dom"), not React, and has no react dependency
//    - if the root tsconfig.json's jsxFactory ever goes missing or drifts out of sync
//    with lib/tsconfig.json (see AGENTS.md's "JSX pragma gotcha"), every .tsx file
//    silently compiles to React.createElement(...) calls instead, and the package
//    crashes on activation with "ReferenceError: React is not defined".
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

  if (src.includes("React.createElement(")) {
    console.error(
      "Found React.createElement(...) in dist/main.js - this package uses etch " +
        '(jsxFactory: "etch.dom"), not React, and has no react dependency. This means ' +
        "the root tsconfig.json's jsxFactory setting is missing or out of sync with " +
        "lib/tsconfig.json (see AGENTS.md's JSX pragma gotcha); every .tsx file compiled " +
        "to React calls instead and the package will crash on activation with " +
        '"ReferenceError: React is not defined".',
    )
    process.exit(1)
  }

  console.log("OK: no dynamic require()/require.resolve() calls or stray React.createElement() in dist/main.js")
}

main()
