# AGENTS.md — pulsar-typescript

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
| Test runner | `atom-ts-spec-runner` (mocha under the hood) | **currently broken**, see Known Broken below |
| Linter | tslint | **currently broken**, see Known Broken below |

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
npm run typecheck       # tsc --noEmit on lib/ and spec/
npm run prettier        # prettier --write
npm run prettier-check  # prettier --check
npm test                # typecheck + prettier-check (this is what CI runs)
npm run lint             # tslint — currently broken, not part of `npm test`, see below
```

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

## Manual verification (no automated UI test exists yet)

There is currently no working automated way to verify the package actually activates
and its LSP features work (see Known Broken below). To check by hand:

```bash
# One-time setup (if not already linked):
#   ppm link <path-to-this-repo>
# then confirm: readlink -f ~/.pulsar/packages/pulsar-typescript  ==  this repo

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

- **`npm run lint` (tslint).** TypeScript 7's npm package no longer exports the
  classic compiler API at all (`require("typescript")` now returns only
  `{version, versionMajorMinor}` — no `ts.sys`, no `ts.createProgram`, no
  `ts.transpileModule`, nothing). tslint needs `ts.sys` to build a `ts.Program` and
  crashes immediately. tslint is also unmaintained upstream since 2019, and
  `tslint.json` has been an empty `{}` ruleset since 2016 — it was catching nothing
  even before this broke, so it was deliberately dropped from `npm test`'s chain
  rather than "fixed". If you want real linting, that means adopting ESLint +
  `typescript-eslint`, a real migration (rule selection, config) — not a quick patch.
- **`pulsar --test spec`.** Same root cause: `atom-ts-spec-runner` uses `ts-node` to
  transpile `.spec.ts` files on the fly, and `ts-node` also needs the classic
  compiler API. A partial fix via npm `overrides` (pinning a nested TypeScript 5 for
  just `ts-node`/`atom-ts-transpiler`) was attempted and reverted: it works under
  npm's legacy peer-deps resolver only by accident (lockfile-sticky, not reproducible
  from a clean install), and doing it properly means either dropping
  `legacy-peer-deps=true` from `.npmrc` (which itself exists to route around
  `atom-ts-transpiler`'s `typescript@<5` peer range being unsatisfiable under
  `typescript@7` — see `14735972`) or hand-patching `node_modules`. Needs a
  deliberate decision, not a quick fix.
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
- Config keys live under the `pulsar-typescript.*` namespace in `atom.config`
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
