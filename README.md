# Project status

This is a fork of the unmaintained [`atom-typescript`](https://github.com/TypeStrong/atom-typescript)
(unmaintained as of May 2022, see [@lierdakil](https://github.com/lierdakil)'s note
there), rebranded and actively maintained for [Pulsar](https://pulsar-edit.dev).

As of the TS7/LSP migration, the package talks to **TypeScript 7's native compiler in
`--lsp` mode** (`tsc --lsp --stdio`) instead of the classic tsserver JSON protocol. A
few features are temporarily degraded as a result (project-wide build, compile on
save — see `AGENTS.md`), and there's a known upstream `typescript-go` crash under
some real editing traffic still being tracked down. See `REWORK.md` for the full,
current status of what's working, what's broken, and what's in progress. If you're
an AI agent working in this repo, read `AGENTS.md` first.

# Pulsar TypeScript

JavaScript developers can now just open a `.ts` file and start hacking
away like they are used to. No `grunt`, no `Visual Studio`. Just pure
coding.

## Installation

1.  Install [Pulsar](https://pulsar-edit.dev).
2.  Install dependencies (see below).
3.  Install `typescript-pulsar` from Pulsar's package manager (`Settings → Install`),
    or `ppm install typescript-pulsar` (`ppm` needs `git` in your path).
4.  Fire up Pulsar. Open a TypeScript file.

**Dependencies**:

Pulsar-TypeScript relies on some external packages for providing some of
its GUI. You basically have two options.

**Option 1**: Install `atom-ide-ui` package (or the individual `atom-ide-*`
packages it bundles: `atom-ide-outline`, `atom-ide-datatip`, `atom-ide-definitions`,
`atom-ide-hyperclick`, `atom-ide-signature-help`, `atom-ide-code-format`).

**Option 2**: Install the following packages:

-   `linter`
-   `linter-ui-default`
-   `hyperclick`
-   `intentions`

**Additional Notes**: [Some packages we
love](https://github.com/TypeStrong/atom-typescript/blob/master/docs/packages.md)
(from upstream `atom-typescript`; still broadly applicable).

## Reviews

*Featured on the TypeScript home page under tools
http://www.typescriptlang.org/* and [demoed by **Anders
Hejlsberg**](https://twitter.com/schwarty/status/593858817894404096).

"I was shocked at how good it felt to poke around on the compiler with
it." [Jonathan Turner](https://twitter.com/jntrnr) 
"And guess what, it
worked perfectly. Like everything else! Faster than Visual Studio!"
[Daniel
Earwicker](http://stackoverflow.com/users/27423/daniel-earwicker) 
"It's
a thing of beauty - they had me at '*Type information on hover*'.
Discovering `tsconfig.json` support as well was just an enormous bonus."
[John Reilly](https://twitter.com/johnny_reilly)
"This may be your best
option for editing TypeScript at the moment - very nice!" [Rasmus
Schultz](https://twitter.com/mindplaydk)

[*Add yours!*](https://github.com/TypeStrong/atom-typescript/issues/66)

# Features

-   Autocomplete
-   Live error analysis
-   Type information on hover
-   Compile on save
-   Project Context Support (`tsconfig.json`)
-   Project Build Support
-   `package.json` Support
-   Goto Declaration
-   Find References
-   Semantic view
-   Block comment and uncomment
-   Rename refactoring
-   Common Snippets
-   Alternative to symbols-view

# FAQ

See [docs/faq.md](docs/faq.md).

------------------------------------------------------------------------

# Feature Details

## Auto Complete

Internally using AutoComplete+. Just start typing and hints will show
up. Or you can explicitly trigger it using `ctrl+space` or `cmd+space`.
Press `tab` to make a selection.

## Type information on hover

Just hover

![you definitely get the point](docs/screens/hover.png)

## Compile on save

When `"compileOnSave": true` is set in `tsconfig.json`, TypeScript files
will be compiled and saved automatically. The compiler does its best to
emit something, even if there are semantic errors in the file.

## Project Support

`atom-typescript` supports all the same options the TypeScript compiler
does as it's using it behind the scenes to do all of the heavy lifting.
In fact, `atom-typescript` will use the exact version of TypeScript you
have installed in your `node_modules` directory.

## Format Code

Shortcut: `ctrl+alt+l` or `cmd+alt+l`. Will format just the selection
if you have something selected otherwise it will format the entire file.

## Go to Declaration

Shortcut: `F12`. Will open the *first* declaration of the said item for
now. (Note: some people call it Go to Definition)

## Find References

Shortcut `shift+F12`. Also called *find usages*.

## Semantic View

A bird's eye view of the current file. Use command
`toggle semantic view`. The view updates while you edit the code. You
can also click to jump to any portion of the file.

![](https://raw.githubusercontent.com/TypeStrong/atom-typescript-examples/master/screens/semanticView.png)

## Refactoring

### Rename

`f2` to initiate rename. `enter` to commit and `esc` to cancel.
![](docs/screens/renameRefactoring.png)

## Quick Fix

Shortcut : `ctrl+enter` on a Mac and `alt+enter` for Windows and Linux
when using `intentions`, `alt+a` when using `atom-ide-ui`. Currently
available codefixes:
https://github.com/Microsoft/TypeScript/tree/master/src/services/codefixes

## Alternative to symbols-view

Atom's `symbols-view` package only works with `ctags`. This is obviously
unsuitable for TypeScript. Hence, we provide two commands to emulate
`symbols-view`:

-   `typescript:toggle-file-symbols`
-   `typescript:toggle-project-symbols`

Both are bound to the same keys as corresponding `symbols-view` commands
by default:

-   `ctrl-r` and `ctrl-shift-r` on PC
-   `cmd-r` and `cmd-shift-r` on Mac

## Contributing

Look at [CONTRIBUTING.md](CONTRIBUTING.md) to get started. If you're an AI agent,
read [AGENTS.md](AGENTS.md) first.

## Changelog

Breaking changes and release notes: [CHANGELOG.md](CHANGELOG.md). For the current
state of the TS7/LSP migration specifically (what's fixed, what's still broken, what
was tried and abandoned), see [REWORK.md](REWORK.md).
