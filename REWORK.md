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
source. It's an upstream `typescript-go` bug report, not a `pulsar-typescript` fix,
once narrowed.

### Update: real sequence captured, but standalone replay of it still doesn't crash

Followed this doc's own next step: added temporary `fs.appendFileSync`-based logging
to every `dispatch()` call, `startServer()`, stderr, and `exitHandler()` in
`lib/client/client.ts` (not committed, reverted after use — see
`scripts/lsp-segfault-probe.js` for the reusable standalone half of this work), then
reproduced the crash live under Xvfb (see AGENTS.md's Manual verification section for
the how-to). Result: **the crash is not hover-specific and not rare** — it fired
3/3 times, immediately on opening a two-line `.ts` file with an obvious type error, no
hover needed. The full captured sequence for one crash (timestamps in ms):

```
starting server .../node_modules/typescript/bin/tsc
-> open      {file, fileContent}                    (textDocument/didOpen)
-> navtree   {file}                                  (textDocument/documentSymbol, +1ms)
<- open ok
-> geterr    {files, delay:0}                        (textDocument/diagnostic, same ms)
-> configure {formatOptions, preferences}             (workspace/didChangeConfiguration, +6ms)
<- configure ok
stderr: panic: runtime error: invalid memory address or nil pointer dereference
        (*Session).getSnapshot(0x0, ...)              <- nil receiver
        (*Session).getSnapshotAndDefaultProject(...)
        (*Session).GetLanguageService(...)
exitHandler: exited with code: 2
```

Same panic signature as originally found (`getSnapshotAndDefaultProject` /
`GetLanguageService`), now with a `0x0` (nil) `*Session` receiver visible in the
trace — strongly suggests a request handler racing session/project creation for a
just-opened file, not anything content-specific. The crash lands ~70ms after
`didOpen`, with `navtree` and `geterr`'s responses never arriving (crashed before
either resolved).

Replayed this exact sequence in a standalone probe (`scripts/lsp-segfault-probe.js`):
`initialize` → `didOpen` → `documentSymbol` request → (+1ms) `diagnostic` request →
(+5ms) `didChangeConfiguration` notification, matching the real client's capabilities
object and millisecond-level spacing. **0/45 crashed** (15 runs with everything fired
in the same tick, 30 more with the realistic staggering above). So the trigger is
real and 100% reproducible in the actual editor, but isn't fully explained by
"these three messages in roughly this order" alone. Also ruled out this round:
`ClientResolver.get()`'s per-file memoization is synchronous before its first
`await`, so it can't be spawning a second racing client for the same file.

Remaining candidates, roughly in the order worth trying next: (1) more concurrent
request types than just documentSymbol+diagnostic — enumerate every
`client.execute(...)` call site under `lib/main/` (there are ~30) and check which
ones a fresh activation with the Outline panel open could plausibly fire within the
first ~100ms, then add those to the probe; (2) something specific to how Atom's
`BufferedNodeProcess` (used in `client.ts`'s real `startServer()`, vs. plain
`child_process.spawn` in the probe) pipes stdin/stdout — worth trying the probe
against a `BufferedNodeProcess`-spawned process if it can be exercised outside a full
Atom/Pulsar process, otherwise instrument further inside the real editor; (3)
restored-editor-session state (the Xvfb repro environment persists window state
across launches, so a killed-not-closed prior run's unsaved buffer/cursor position
gets restored on the next launch) — try a repro with a fresh `~/.pulsar` config dir
or explicit session-restore-disabled launch to rule this out as a contributing
factor.

#### Update: decoupled-controller race also fails to reproduce standalone

Traced candidate (1) further: `lib/client/client.ts`'s `dispatch()` cases for "open"
and "navtree" have no `await` before their `sendNotification`/`sendRequest` call, so
JS call order should equal wire order as long as both calls happen in the same
synchronous tick, which ruled out a `reportBusyWhile` (`atom-ide-busy-signal`,
`lib/main/pluginManager.ts`) reordering theory on inspection — its `reportBusyWhile`
calls `f()` synchronously before its first `await`, same as a bare call. The real
architectural difference from the original probe: `TypescriptBuffer.open()`
(`lib/main/typescriptBuffer.ts`, sends "open" then fire-and-forget "geterr" then,
after a real `findConfigFile` fs walk, "configure") and `getOutlineProvider()`
(`lib/main/atom-ide/outlineProvider.ts`, sends "navtree") are two **fully independent**
consumers of the same pooled client with zero cross-awaiting, both triggered off the
same active-editor-changed event — not one script firing requests in a chosen order.

Added `oneRunDecoupled()` to `scripts/lsp-segfault-probe.js` (`node
scripts/lsp-segfault-probe.js decoupled [n]`) to model this: three independent async
"controllers" (open/geterr/configure with a real `fs.promises.access` gap instead of
a fixed sleep, navtree, and documentHighlight for occurrence-on-initial-cursor) fired
from the same tick with no ordering between them, letting the real event loop decide
interleaving instead of a hand-picked stagger. **0/40 runs crashed.** So an
unsynchronized multi-consumer race over the same connection isn't sufficient on its
own either — narrowed candidate (3) (restored-editor-session state) by relaunching
live against a project directory Pulsar had never opened before (fresh fixture dir,
untouched `ATOM_HOME` storage entry, same installed package set including
`atom-ide-outline`/`busy-signal`): **crashed again**, immediately on open, no hover.
Rules out session-restore state as a contributing factor.

### Root cause identified: nil `*Session` panics inside its own `sync.Mutex.Lock`, server-side

This live run's DevTools console had the panic's full text (previous captures had it
truncated by the notification dialog). The complete trace, expanded:

```
tsc --lsp stderr: panic: runtime error: invalid memory address or nil pointer dereference
[signal SIGSEGV: segmentation violation code=0x1 addr=0x3c8 pc=0xb7d046]

goroutine 19 [running]:
internal/sync.(*Mutex).Lock(...)
	internal/sync/mutex.go:63
sync.(*Mutex).Lock(...)
	sync/mutex.go:46
github.com/microsoft/typescript-go/internal/project.(*Session).getSnapshot(0x0, {0x1172818, 0xd39966100f0}, {0x3996614040, 0x1, 0x1}, {0x0, 0x0}, {0x0, ...}, ...)
	github.com/microsoft/typescript-go/internal/project/session.go:909 +0x66
github.com/microsoft/typescript-go/internal/project.(*Session).getSnapshotAndDefaultProject(0x0, {0x1172818, 0xd39966100f0}, {0x3996630000, 0xa0}, 0x0)
	github.com/microsoft/typescript-go/internal/project/session.go:976 +0x13d
github.com/microsoft/typescript-go/internal/project.(*Session).GetLanguageService(0x116e340?, {0x1172818?, 0xd39966100f0}, {0x3996630000?, 0xa0?})
	github.com/microsoft/typescript-go/internal/project/session.go:989 +0x25
github.com/microsoft/typescript-go/internal/lsp.init.func1.registerLanguageServiceDocumentRequestHandler[...].23({0x1172818, 0xd39966100f0}, 0x3996569050)
	github.com/microsoft/typescript-go/internal/lsp/server.go:865 +0x85
github.com/microsoft/typescript-go/internal/lsp.(*Server).handleRequestOrNotification(0x3996651e008, {0x1172850?, 0x3996660a050?}, 0x3996569050)
	github.com/microsoft/typescript-go/internal/lsp/server.go:703 +0xec
github.com/microsoft/typescript-go/internal/lsp.(*Server).dispatchLoop(0x3996651e008)
	github.com/microsoft/typescript-go/internal/lsp/server.go:577 +0x445
github.com/microsoft/typescript-go/internal/lsp.(*Server).Run.func1()
	github.com/microsoft/typescript-go/internal/lsp/server.go:426 +0x1f
golang.org/x/sync/errgroup.(*Group).Go.func1()
	golang.org/x/sync/errgroup.go:93 +0x50
created by golang.org/x/sync/errgroup.(*Group).Go in goroutine 1
	golang.org/x/sync/errgroup.go:78 +0x95
```

Same `addr=0x3c8 pc=0xb7d046` as the very first capture in this document, across
different sessions/machines-state — this is a deterministic bug at a fixed code
address, not memory corruption or a heisenbug. And the new frame that wasn't visible
before (`sync.(*Mutex).Lock` at the very top, called from `getSnapshot` with a `0x0`
receiver) pins down the actual fault: `(*Session).getSnapshot` is called on a **nil**
`*Session`, and the first thing it does is lock a mutex field on that nil receiver,
which dereferences the nil pointer.

`dispatchLoop` -> `handleRequestOrNotification` -> `errgroup.Group.Go` shows *every*
incoming LSP request/notification is dispatched into its own goroutine by the server
itself, concurrently, with no visible synchronization against session/project
creation. So the race isn't in this client (already fairly thoroughly probed above,
including a decoupled multi-consumer replay) — it's server-side: some request handler
(routed through `registerLanguageServiceDocumentRequestHandler`, i.e. any of the
`textDocument/*` requests that need a live language service, not just hover) reads
a per-session pointer that is still nil because the project/session for the
just-opened file hasn't finished being constructed by (presumably) the `didOpen`
handler yet, and nothing blocks the request handler from running first.

**Conclusion: this is confirmed to be an upstream `typescript-go` bug** (a
request-vs-session-initialization race with no synchronization, causing a nil-pointer
panic reachable from ordinary editor usage, not just adversarial timing) and should be
filed against `microsoft/typescript-go` with the trace above, not chased further as a
client-side fix. Nothing under `lib/` in this repo can work around a nil receiver
panic inside the vendored Go binary; the only real client-side mitigation available is
auto-restarting the crashed server (see `client.ts`'s `exitHandler`/`restarted` event,
already in place) so a crash degrades to "features reset" rather than "package dead
until reload," which is already how the client behaves today.

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

1. File the upstream `microsoft/typescript-go` issue for the segfault (root cause now
   identified, see "Root cause identified" under "Open issue" above: a nil `*Session`
   panics inside its own mutex lock, reached from any concurrent `textDocument/*`
   request racing session/project creation after `didOpen`, server-side, not a client
   bug). Include the full trace already captured, the exact deterministic
   `addr=0x3c8 pc=0xb7d046`, and note it reproduces from ordinary editor usage (fresh
   file, no hover) not just adversarial timing. No further client-side narrowing work
   is needed before filing.
2. Do a real manual pass through the feature list in `README.md` (autocomplete,
   definitions, references, rename, code actions, format, signature help) the way
   hover was spot-checked this round, now that the LSP client actually reaches the
   server. None of the others have been individually verified live yet.
3. Decide on and execute one of the three options above for
   `npm run lint`/`pulsar --test spec`.
4. ~~Once tests can run, add coverage for the `resolveBinary.ts` dynamic-require
   class of bug specifically~~ Done: `scripts/verify-bundle.js` scans `dist/main.js`
   for any `require(...)`/`require.resolve(...)` call whose argument isn't a string
   literal, wired into `npm run build` (also runnable standalone via `npm run
   verify-bundle`). Verified it actually catches a regression: injecting a fake
   `require(process.env.X)` into `lib/` and rebuilding fails the build with the
   exact call site; reverting and rebuilding passes clean. This doesn't need
   `npm test`'s broken spec runner (see below) since it operates on the built
   artifact, not source.
