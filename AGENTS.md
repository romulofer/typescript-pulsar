# AGENTS.md — typescript-pulsar

Guidance for AI agents working in this repository. Read this before touching code.

## Agent Policy (MUST FOLLOW)

- **Never author or co-author commits.** Do not set yourself as git author/committer, and never add a `Co-Authored-By` trailer naming any AI. Commits are authored by the human developer only.
- **Never commit or push on your own initiative.** Only commit/push when the user explicitly asks for it *in that moment* — a prior "yes" is not standing authorization for the rest of the session.
- Do not open pull requests, create/delete remote branches, or otherwise mutate remote state without explicit instruction.
- Local git operations (status, diff, log, add, local commit when explicitly requested) are fine within the above constraints.
- Do not use em dashes in written prose (commit messages, docs, comments). Use a comma, colon, or period instead.

## Project Overview

Pulsar (Atom-fork) package that provides TypeScript/JavaScript IDE features: hover,
completion, definitions, references, outline, rename, code actions/fixes, refactors,
format, signature help, diagnostics. Rebranded/forked from `atom-typescript` for
[Pulsar](https://pulsar-edit.dev). Upstream `atom-typescript` is unmaintained
(see README.md); this fork is the active line of work.

As of August 2026 the package talks to **TypeScript 7's native compiler in `--lsp`
mode** (`tsc --lsp --stdio`), not the classic tsserver JSON protocol. This was a full
transport rewrite (see `f313cf99` and the commits after it) — the client speaks
standard LSP via `vscode-jsonrpc`, not the old `typescript/lib/protocol` shapes.
Internal command names (`"geterr"`, `"navtree"`, `"quickinfo"`, etc.) are kept from
the old protocol as identifiers in `lib/client/client.ts`'s dispatch switch, but every
request/response on the wire is LSP-shaped.

## Tech Stack

| Category | Technology | Notes |
|---|---|---|
| Language | TypeScript | compiled with TypeScript **7** (native, Go-based compiler) |
| Bundler | Parcel 2 | `lib/main/atomts.ts` → `dist/main.js`, target `electron-renderer` |
| UI | [etch](https://github.com/atom/etch) | **not React** — `jsxFactory: "etch.dom"`. See the JSX pragma gotcha below. |
| LSP transport | `vscode-jsonrpc` / `vscode-languageserver-protocol` | types-only import for the protocol types; a small hand-picked set of LSP enum values lives in `lib/client/lspConstants.ts` so the full `vscode-languageserver-protocol` package never needs to be bundled |
| Test runner | `atom-ts-spec-runner` (mocha under the hood) | working, see the classic-TypeScript-for-tooling gotcha below |
| Linter | ESLint + typescript-eslint (`eslint.config.js`) | working, same gotcha |

## Architecture

```
lib/
├── client/          LSP transport: spawns `tsc --lsp --stdio`, JSON-RPC connection,
│                     command dispatch (client.ts), binary/tsconfig resolution
│                     (resolveBinary.ts), per-tsconfig client pooling (clientResolver.ts)
├── main/
│   ├── atomts.ts     package entry point (activate/deactivate, exports provide*/consume*)
│   ├── pluginManager.ts   wires consumedServices/providedServices from package.json to
│   │                       the actual provider objects; owns the ClientResolver + ErrorPusher
│   ├── typescriptBuffer.ts   per-TextBuffer state: debounced diagnostics pull ("geterr"),
│   │                          compile-on-save, open/close/change lifecycle
│   ├── errorPusher.ts    converts pulled LSP diagnostics into linter-indie messages
│   ├── atom/         Atom-specific providers/commands (autocomplete, commands/, codefix/,
│   │                  components/ [etch UI], occurrence/, views/)
│   └── atom-ide/      atom-ide-ui service providers (outline, datatip, definitions,
│                       hyperclick, codeHighlight, signature help, code actions)
└── typings/          generated + hand-written .d.ts (atom-config.d.ts is generated,
                       see gen-config-types below — do not hand-edit it)
```

`pluginManager.ts` is the hub: package.json's `consumedServices`/`providedServices`
map to its `consume*`/`provide*` methods. If you add a new editor feature that needs
a Pulsar/atom-ide service, wire it there and add the matching entry in package.json.

## Commands

```bash
npm run build          # production build: dist/main.js (must be committed, see below)
npm run dev             # parcel watch, development build
npm run typecheck       # node_modules/@typescript/native/bin/tsc --noEmit on lib/ and spec/
npm run prettier        # prettier --write
npm run prettier-check  # prettier --check
npm run lint             # eslint . (type-aware; see the classic-TypeScript-for-tooling gotcha below)
npm test                # typecheck + prettier-check + lint (this is what CI's "Run static checks" step runs)
```

CI also runs `pulsar --no-sandbox --test spec` as a separate step before `npm test` (see
`.github/workflows/ci.yml`) — that's the actual `spec/` suite, not part of `npm test`.

**`dist/` is committed.** Atom/Pulsar packages ship transpiled/bundled JS, not source
— `dist/main.js` and `dist/main.js.map` are checked into git and must be rebuilt and
included in any commit that changes `lib/`. Never hand-edit files under `dist/`.

## Critical gotcha: no dynamic `require()` in `lib/`

**Never write `require(someRuntimeString)` or `require.resolve(someRuntimeString)`
anywhere in `lib/`.** Parcel's `electron-renderer` bundler (see the `bundle` target in
package.json) cannot statically analyze a dynamic require, and in the packaged
`dist/main.js` it silently resolves to something non-callable at runtime — no
build-time error, no crash on activation, just a `TypeError: undefined is not a
function` the first time that code path actually runs. This exact bug (`700b152b`)
took down every LSP-backed feature in the package (hover, completion, outline,
diagnostics — everything) while activation and syntax highlighting looked completely
fine, because `resolveBinary()` is only called lazily, the first time a file actually
needs a client.

If you need to read a `package.json` or similar JSON file at a runtime-computed path,
use `fs.readFile`/`JSON.parse` (see `resolveBinary.ts`'s `fsReadFile` helper). If you
need Node-style module resolution from a runtime-computed base directory, use the
`resolve` npm package (already a dependency, see `resolveModule()` in
`resolveBinary.ts`) rather than `require.resolve`.

Static `require("some-literal-string")` calls to packages marked external in
`targets.bundle.includeNodeModules` (atom, electron, typescript, vscode-jsonrpc) are
fine and pass through untouched — the danger is specifically a *dynamic* string.

**After any change to `lib/`, verify the built `dist/main.js` actually works** — a
clean `npm run build` and `npm run typecheck` prove nothing about this class of bug.
See "Manual verification" below.

## JSX pragma gotcha

`lib/tsconfig.json` sets `jsxFactory: "etch.dom"` (etch, not React — this package has
no `react` dependency and never imports it). Parcel's `@parcel/transformer-js` only
reads JSX-pragma config from a **`tsconfig.json` at the project root**, not from
`lib/tsconfig.json`. That's why a nearly-empty root `tsconfig.json` exists
(`{"compilerOptions": {"jsxFactory": "etch.dom"}}`) — it exists purely so Parcel picks
up the right pragma; it is not used for typechecking (that's `lib/tsconfig.json` via
`npm run typecheck`). **Do not delete the root `tsconfig.json`, and if `jsxFactory`
ever changes in `lib/tsconfig.json`, mirror it there too**, or every `.tsx` file will
silently compile to `React.createElement(...)` calls and crash activation with
`ReferenceError: React is not defined` (this exact bug: `8ccc6b45`).

## Classic-TypeScript-for-tooling gotcha (`typescript` vs `@typescript/native`)

TypeScript 7's npm package no longer exports the classic compiler API at all
(`require("typescript")` in a plain `typescript@7` install returns only
`{version, versionMajorMinor}` — no `ts.sys`, no `ts.createProgram`, no
`ts.transpileModule`). But plenty of tooling still needs that API: `ts-node`
(via `atom-ts-spec-runner`, for running `spec/**/*.spec.ts`), `atom-ts-transpiler`,
and `typescript-eslint` (confirmed: it refuses to even parse against `typescript@7`,
see https://github.com/typescript-eslint/typescript-eslint/issues/10940) all break.

Fixed by following the exact pattern VS Code's own repo uses for this transition
(see `references/vscode-ts-extension` if still around, or its `package.json`): alias
the plain `"typescript"` dependency name to the classic-API-compatible
`@typescript/typescript6` package (published by the TypeScript team specifically for
this), and alias the real native `typescript@7` engine under a different name instead.

Concretely, in this repo:
- `dependencies`: `"@typescript/native": "npm:typescript@^7.0.2"` — the real engine.
  `lib/client/resolveBinary.ts`'s bundled-fallback lookup resolves this name.
- `devDependencies`: `"typescript": "npm:@typescript/typescript6@^6.0.2"` — classic
  API, used by ESLint (`eslint.config.js`) and transitively by `ts-node`/
  `atom-ts-transpiler` (this incidentally also fixed `pulsar --test spec`, which
  needs `ts-node`, at the same time — same underlying blocker, same fix).
- `includeNodeModules` in the Parcel `bundle` target marks `"@typescript/native"`
  external (not `"typescript"`).
- `npm run typecheck`/`npm run tsc` invoke `node_modules/@typescript/native/bin/tsc`
  **explicitly**, not the bare `tsc` on PATH — classic TS6 doesn't ship its own CLI
  binary so there's no actual collision today, but don't rely on that; always use the
  explicit path so `typecheck` can never silently start using the wrong compiler.

**A real, sharp edge from this**: classic TS6's type inference occasionally
*disagrees* with the real native TS7 compiler on generic overload resolution (seen
concretely: `@typescript-eslint/no-unnecessary-type-assertion`'s `--fix` removed two
type assertions in `client.ts` that TS6 considered redundant but TS7 does not —
`npm run typecheck` failed until they were restored). **Never blindly trust
`eslint --fix` for `no-unnecessary-type-assertion` in this repo** — always run
`npm run typecheck` (against the real `@typescript/native`) after, and if it
disagrees, restore the assertion with an inline
`// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion`
and a comment explaining why (see the two spots in `client.ts` for the pattern).
Also note: the disable comment must be immediately above the **first line of the
statement**, not above the line where the `as X` token itself appears — this rule
attributes the violation to the start of the expression, not the assertion site.

If a real user's project has its own `typescript` dependency (any version), that is
completely unaffected by any of this — `resolveBinary.ts`'s *first* lookup (searching
from the file being edited) still resolves the literal `"typescript"` name from the
user's own `node_modules`, exactly as before. Only this package's own bundled
fallback and dev tooling changed names.

## Manual verification (no automated UI test exists yet)

There is currently no working automated way to verify the package actually activates
and its LSP features work (see Known Broken below). To check by hand:

```bash
# One-time setup (if not already linked):
#   ppm link <path-to-this-repo>
# then confirm: readlink -f ~/.pulsar/packages/typescript-pulsar  ==  this repo

npm run build
unset ELECTRON_RUN_AS_NODE   # otherwise the CLI wrapper launches node's own --help
xvfb-run -a pulsar --wait <some-dir-with-a-tsconfig.json> <a.ts-file-in-it>
```

If there's no real display available, use Xvfb as above. Notes specific to that
environment, learned the hard way this session:

- `xvfb-run` picks a **new** display/temp-auth-dir every launch (`/tmp/xvfb-run.XXXXXX`,
  `:99`, `:100`, ...). Don't hardcode a display number across launches — detect the
  current one (`ls -dt /tmp/xvfb-run.* | head -1` plus the newest socket under
  `/tmp/.X11-unix/`). Stale leftover temp dirs from earlier killed sessions will
  confuse a naive "most recent" lookup unless you sort by mtime.
- The `pulsar` CLI wrapper **detaches and exits immediately** by default; combined
  with `xvfb-run`, that kills the X server the moment the wrapper returns, before
  Electron has even started. Always pass `--wait` so the wrapper blocks until you
  close the app.
- There is no window manager under bare Xvfb. Keyboard shortcuts that depend on
  window focus/activation (e.g. `Ctrl+Shift+I` for dev tools) are unreliable; use the
  `View` menu (mouse clicks via `xdotool`) instead — `View → Developer → Toggle
  Developer Tools` works reliably.
- **Always kill every spawned `pulsar`/`Xvfb`/`xvfb-run` process (and clean stale
  `/tmp/xvfb-run.*` dirs) before finishing.** Zombie instances silently pile up across
  turns and burn CPU; `pkill -9 -f` by exact matched PID list, not just by pattern,
  and verify with `ps aux` afterward.
- Check the DevTools **Console** tab for real runtime errors — the notification
  banner shown for an activation failure or a crashed `tsc --lsp` process only shows
  a truncated view; the full stack (with real file:line pointing into the TypeScript
  sources, since sourcemaps are shipped) is in the console.

## Known Broken (do not assume these work without checking first)

- ~~`npm run lint` (tslint)~~ **Fixed.** Replaced tslint (unmaintained since 2019,
  empty `{}` ruleset anyway) with ESLint + `typescript-eslint`, made to actually work
  against TypeScript 7 by the classic-TypeScript-for-tooling fix above. Real,
  type-aware linting: `@typescript-eslint/recommendedTypeChecked` for `lib/`/`spec/`,
  plain `eslint:recommended` for `scripts/**/*.js`. `any`/unsafe-*/floating-promise
  rules are deliberately set to `warn` rather than `error` (86 pre-existing warnings
  as of this fix, not worth a mass unrelated refactor to silence); everything else is
  `error` and `npm run lint` is clean. Wired into `npm test`.
- ~~`pulsar --test spec`~~ **Fixed**, for free, by the same classic-TypeScript fix
  above (`ts-node`'s `require("typescript")` now resolves to classic TS6 too). 25
  passing specs as of this fix, including `spec/client/client.spec.ts`, a regression
  test for the handshake-ordering bug (see REWORK.md's "RESOLVED" section) using a
  fake LSP server fixture (`spec/fixtures/handshake-order-server.js`) that exits with
  a distinctive code if it receives anything before responding to `initialize` —
  verified to actually catch the regression by temporarily reverting the fix and
  confirming the test fails.
- **`typescript:build` (project-wide emit)** is disabled — no LSP equivalent exists
  yet for tsserver's old `compileOnSaveAffectedFileList`/`compileOnSaveEmitFile`.
  `typescript:check-all-files` now only checks open editors, not the whole project.
  `compileOnSave` rejects with a clear error message rather than silently no-op'ing.
  These are documented, intentional degradations from the LSP migration, not bugs to
  silently "fix" without first confirming an LSP equivalent actually exists upstream.
- ~~The `tsc --lsp` server itself (typescript-go...) can segfault~~ **Fixed.** Root
  cause (see REWORK.md's "RESOLVED" section): this client was violating the LSP
  spec's initialize/initialized handshake, sending its first real command
  concurrently with `initialize` instead of after `initialized`, which let
  `textDocument/*` requests reach `typescript-go`'s server before its session existed
  — hitting a server-side nil-pointer bug that crashes the whole process instead of
  erroring gracefully. `client.ts`'s `execute()` now awaits the handshake
  (`initializePromise`) before dispatching anything. Verified standalone (15/15
  crashes without the fix, 0/15 with it, same binary) and live in Pulsar. The
  server-side gap (`registerLanguageServiceDocumentRequestHandler` missing the same
  nil-session guard its sibling handler-registration helpers have) is still real and
  worth reporting upstream as defense-in-depth, but no longer affects this package.

See `REWORK.md` for the full narrative of what's been fixed, what's still open, and
what was tried and abandoned (with reasons) — read it before re-attempting anything
listed above as "attempted and reverted".

## Conventions

- No comments explaining *what* code does; only *why*, when non-obvious (see the
  gotcha comments already in `resolveBinary.ts` and `typescriptBuffer.ts` for the
  house style).
- Config keys live under the `typescript-pulsar.*` namespace in `atom.config`
  (renamed from `atom-typescript.*` during the Pulsar rebrand — don't reintroduce the
  old prefix).
- `lib/typings/atom-config.d.ts` is **generated** from package.json's `configSchema`
  by `scripts/typed-config.js` (`npm run gen-config-types`, which `npm run build`
  runs automatically). Don't hand-edit it; edit the `configSchema` in package.json
  instead and regenerate.
- Diagnostics flow through one conversion point: `lspDiagnosticToDiagnostic()` in
  `lib/client/clientResolver.ts` converts LSP's `{range, severity, message}` shape
  into the classic 1-indexed `{start, end, text, category}` shape that
  `errorPusher.ts` and the rest of the UI still expect. If you add a new diagnostic
  source, convert at that boundary, not ad hoc elsewhere.
