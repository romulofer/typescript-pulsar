# REWORK.md — TS7/LSP migration follow-up

Narrative log of what was found and fixed after the initial TypeScript 7 / LSP
migration (`f313cf99`) and its first "fix production build" follow-up (`14735972`),
plus what is still open. Read this before re-attempting anything listed under
"Attempted and reverted" — it explains why the obvious-looking fix didn't land.

## Context

`f313cf99` rewrote the plugin's transport from the classic tsserver JSON protocol to
standard LSP (`tsc --lsp --stdio`, TypeScript 7's native Go-based compiler) and
rebranded the package for Pulsar. `14735972` fixed the production build (Parcel
version bump, dropped a classic-compiler-API-dependent transformer, patched a peer
dependency issue) and claimed the package "activates without console errors after
`ppm link`". That claim was true only in the narrowest sense: the package didn't show
an error *dialog*. It was not actually functional. See below.

## Fixed this round

### 1. Activation crash: `ReferenceError: React is not defined` (`8ccc6b45`)

Every `.tsx` file in `dist/main.js` compiled to `React.createElement(...)` calls, but
the package has no `react` dependency and never imports it — it uses `etch`
(`jsxFactory: "etch.dom"` in `lib/tsconfig.json`). Root cause: `14735972` dropped
`@parcel/transformer-typescript-tsc` (it used the classic `ts.transpileModule` API,
gone in TS7) in favor of Parcel's default `@parcel/transformer-js`, which reads JSX
pragma config **only from a `tsconfig.json` at the project root** — and there wasn't
one. Fix: added a root `tsconfig.json` with `jsxFactory: "etch.dom"` (see AGENTS.md's
"JSX pragma gotcha" — this file must not be deleted, and must stay in sync with
`lib/tsconfig.json` if the pragma ever changes).

Same commit also fixed the `npm test` pipeline so it can run at all: `typecheck`
referenced a `scripts/tsconfig.json` deleted back in 2021 (dead `.ts`-free directory,
just dropped the leg); `spec/tsconfig.json` needed an explicit `rootDir` (TS7 got
stricter about inferring it) and an explicit `types` array (TS7 stopped
auto-including `@types/mocha`'s ambient globals the way earlier TS did in this
config shape); 4 files had prettier drift from the migration itself, fixed and the
deprecated `jsxBracketSameLine` option dropped from `.prettierrc`; `npm run lint`
(tslint) was dropped from the `test` script chain (see Known Broken in AGENTS.md —
it was already inert, `tslint.json` has been `{}` since 2016).

### 2. Lockfile drift (`194a4a3e`)

`package-lock.json` still listed `patch-package` and `@yarnpkg/lockfile`, neither of
which `package.json` declares. Unrelated pre-existing drift (not caused by the
migration), fixed by a clean `rm -rf node_modules package-lock.json && npm install`.

### 3. The big one: every LSP feature was silently dead (`700b152b`)

`14735972`'s claim that the package "activates without console errors" was checked
by looking for an activation-failure *dialog*, not by opening DevTools. It never
threw at activation time because `resolveBinary()` — the function that locates the
`tsc` binary — is only called **lazily**, the first time any feature (hover,
completion, outline, diagnostics, anything) actually needs a client. When it finally
ran, in the packaged build:

```
Uncaught (in promise) TypeError: undefined is not a function
    at resolveBinary.ts:48:12
```

Two separate dynamic `require()`/`require.resolve()` calls in `resolveBinary.ts`
(one reading a resolved `package.json`, one as the bundled-typescript fallback) —
Parcel's `electron-renderer` bundler cannot statically resolve either, and silently
produces something non-callable at runtime instead of erroring at build time. Fixed
by reading the target `package.json` with `fs.readFile`/`JSON.parse` instead of
`require`, and rerouting the fallback through the `resolve`-package-based
`resolveModule()` helper already used for the primary lookup (rooted at
`__dirname`), instead of `require.resolve`. See AGENTS.md's "no dynamic require"
gotcha — **this is the single most important thing to know about this codebase's
Parcel bundling**, and it's easy to reintroduce by accident in new code.

Verified live (Xvfb + DevTools console, see AGENTS.md for the how-to): before the
fix, the status bar was permanently stuck showing just "TypeScript" (the bare
grammar label) and the Outline panel always said "Provider is unavailable". After
the fix, the status bar reports the real client version ("TypeScript 7.0.2") and a
standalone probe against the same `tsc --lsp` binary confirmed hover, document
symbols, and pull diagnostics all return correct data server-side.

### 4. `rootUri: null` → real `rootUri`/`workspaceFolders` (`ebc06e9f`)

The `initialize` request hardcoded `rootUri: null` and sent no `workspaceFolders`.
Fixed by threading the resolved project root (the containing directory of the
nearest `tsconfig.json`, or the file's own directory when none is found) from
`ClientResolver._get()` through `Client`'s constructor into the `initialize` call.
This is a correctness fix on its own (a well-behaved LSP client tells the server what
project it's serving) independent of the issue below, which it does **not** fully
explain.

## Open issue: `tsc --lsp` (typescript-go) can segfault

While verifying fix #4, the LSP server itself crashed:

```
panic: runtime error: invalid memory address or nil pointer dereference
[signal SIGSEGV: segmentation violation code=0x1 addr=0x3c8 pc=0xb7d046]
...
github.com/microsoft/typescript-go/internal/project.(*Session).getSnapshot(...)
github.com/microsoft/typescript-go/internal/project.(*Session).getSnapshotAndDefaultProject(...)
github.com/microsoft/typescript-go/internal/project.(*Session).GetLanguageService(...)
```

Triggered by a plain hover request from this client, reproducibly (multiple
launches, multiple request types — hover and hover-after-edit both triggered it).
**Not** reproduced by a minimal standalone LSP client (a ~60-line script using the
same `vscode-jsonrpc` package, sending `initialize` → `didOpen` → `hover`/
`documentSymbol`/`textDocument/diagnostic` against the exact same file and
`tsconfig.json`) — that succeeded cleanly every time, including 5/5 runs with
concurrent requests. Ruled out so far as the trigger:

- Missing `rootUri`/`workspaceFolders` (fixed in #4 above; crash persisted after).
- A minimal `tsconfig.json` with no `include`/`files` list (added `"include":
  ["**/*"]`; crash persisted).
- Request concurrency alone (the standalone probe fired `documentSymbol` and
  `textDocument/diagnostic` concurrently via `Promise.all`, 5/5 clean).

Not yet isolated: the addon's fuller `ClientCapabilities` object (documentSymbol
hierarchical support, codeAction literal support, rename prepare support, completion
resolve support, publishDiagnostics tag support, workspace applyEdit) versus the
probe's empty `capabilities: {}`; the `workspace/didChangeConfiguration` notification
the addon sends via the `"configure"` command; or some specific interleaving of
`didOpen`/`didChange`/request traffic that only the real editor produces (mouse-hover
datatip timing, debounced `geterr` firing close to another in-flight request).

This lives inside vendored native Go code (`typescript-go`, via the `typescript@7`
npm package) — there is nothing to patch in this repository's own TypeScript/JS
source. If picked back up: instrument `lib/client/client.ts` (or a copy of the
standalone probe, see the git history of this session's scratch work — it was not
committed, write a new one under `scripts/` if useful) to log every request/
notification sent in the real editor flow immediately before a crash, then try to
reproduce that exact sequence in a standalone probe to narrow it down. Once narrowed,
it's an upstream `typescript-go` bug report, not a `pulsar-typescript` fix.

## Attempted and reverted: fixing `pulsar --test spec` / `npm run lint`

Both `atom-ts-spec-runner` (via `ts-node`) and `tslint` need the classic TypeScript
compiler API (`ts.sys`, `ts.createProgram`, `ts.transpileModule`), which the
`typescript@7` npm package no longer exports at all — `require("typescript")` in
this environment returns only `{version, versionMajorMinor}`. Nothing else. This is
the same root cause `14735972` already called out for `atom-ts-transpiler` (hence
the `.npmrc` `legacy-peer-deps=true` and the `postinstall.js` patch), just hitting
two more consumers.

Tried: npm `overrides` to pin a nested `typescript@4.9.5` specifically for
`ts-node`/`atom-ts-spec-runner`/`atom-ts-transpiler`, e.g.:

```json
"overrides": {
  "ts-node": { "typescript": "4.9.5" },
  "atom-ts-transpiler": { "typescript": "4.9.5" }
}
```

This *can* work (confirmed: with it in place, `atom-ts-spec-runner`'s own
`require("typescript")` resolves to a working 4.9.5 with real `ts.sys` etc.), but
running `npm install` under the current `legacy-peer-deps=true` resolver does not
reliably create the necessary nested `node_modules/ts-node/node_modules/typescript`
— it only "worked" once, and turned out to be lockfile-sticky residue from an
earlier resolver pass, not reproducible from a clean `rm -rf node_modules
package-lock.json && npm install`. Running with the modern (non-legacy) peer
resolver does create the correct nested structure, but then `npm install` itself
fails with an `ERESOLVE` conflict on `atom-ts-transpiler`'s `typescript@<5` peer
range — the exact problem `legacy-peer-deps=true` exists to route around in the
first place.

Reverted rather than landed. To actually fix this, pick one:

1. Drop `legacy-peer-deps=true` and instead resolve `atom-ts-transpiler`'s peer
   conflict some other way (e.g. via `overrides` forcing *its* peer to a satisfiable
   version, verified to actually nest correctly under the modern resolver before
   committing to it), then add the `ts-node`/`atom-ts-spec-runner` overrides.
2. Vendor/pin a working classic-API TypeScript some other way (e.g. a checked-in
   dev-only copy, or a `postinstall.js` step that copies one into the right
   `node_modules/*/node_modules/typescript` locations) — more explicit, less
   fighting the resolver, but more moving parts to keep in sync.
3. Replace `tslint` with ESLint + `typescript-eslint` (tslint is unmaintained
   upstream since 2019 regardless of this bug) and separately decide whether
   `atom-ts-spec-runner`/`ts-node` is still the right test-runner choice for a
   TS7-only codebase, or whether it's worth switching to something that doesn't need
   the classic compiler API at all.

Whichever path: verify with a **clean** `rm -rf node_modules package-lock.json && npm
install` before declaring it fixed — this bug bit twice specifically because a
resolution that looked correct turned out to only work by accident, from leftover
lockfile state.

## Still-degraded features (intentional, not regressions)

Carried over from the original migration (`f313cf99`), not touched this round:

- `typescript:build` (project-wide emit) is disabled — no LSP equivalent exists yet
  for tsserver's old `compileOnSaveAffectedFileList`/`compileOnSaveEmitFile`.
- `typescript:check-all-files` now only checks open editors, not the whole project.
- `compileOnSave` rejects with a clear error message instead of silently no-op'ing.

## Suggested next steps, roughly in priority order

1. Narrow down and report (or fix, if it turns out to be a client-side trigger after
   all) the `typescript-go` segfault — this is the thing most likely to make the
   package unusable in real-world editing, not just in this minimal repro.
2. Do a real manual pass through the feature list in `README.md` (autocomplete,
   definitions, references, rename, code actions, format, signature help) the way
   hover was spot-checked this round, now that the LSP client actually reaches the
   server. None of the others have been individually verified live yet.
3. Decide on and execute one of the three options above for
   `npm run lint`/`pulsar --test spec`.
4. Once tests can run, add coverage for the `resolveBinary.ts` dynamic-require class
   of bug specifically (e.g. a smoke test that actually builds with Parcel and
   greps/exercises the bundle) so it can't silently regress the way it did here.
