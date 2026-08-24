import * as fs from "fs"
import * as jsonc from "jsonc-parser"
import * as path from "path"
import Resolve from "resolve"

export interface Binary {
  version: string
  pathToBin: string
}

interface ConfigObject {
  tsdkPath: string
}

interface VSCodeConfigObject {
  "typescript.tsdk": string
}

export type TypescriptSource = "auto" | "bundled" | "tsdkPath" | "local"

/**
 * Locates the `tsc` binary (TypeScript >=7's native compiler, which also serves as the LSP
 * server via `tsc --lsp --stdio`). Unlike the classic `typescript` package, TypeScript 7 no
 * longer ships `lib/tsserver.js` — the only entry point is `bin/tsc`.
 *
 * Which install gets used is governed by the `typescript-pulsar.typescriptSource` setting:
 * - "bundled": always the package's own bundled TypeScript 7 native compiler.
 * - "tsdkPath": always `typescript-pulsar.tsdkPath` (errors if unset or missing).
 * - "local": always the project's `node_modules/typescript` (errors if not found; user's
 *   choice to make even if it's <7 and can't actually serve `--lsp`).
 * - "auto" (default): aux config file (.atom-typescript.json/.vscode) -> tsdkPath setting ->
 *   local project typescript (only if >=7) -> bundled.
 */
export async function resolveBinary(sourcePath: string): Promise<Binary> {
  const source = (atom.config.get("typescript-pulsar.typescriptSource") ?? "auto") as
    | TypescriptSource
    | undefined

  switch (source) {
    case "bundled":
      return resolveBundled()
    case "tsdkPath":
      return resolveTsdkPathSetting(true)
    case "local":
      return resolveLocal(sourcePath, false)
    case "auto":
    default: {
      // Explicit user overrides win outright, even on a <7 install — that's the user's call,
      // not ours. Only the silent, auto-detected local `node_modules/typescript` gets a
      // version gate, since picking that one wasn't a deliberate choice and can't be allowed
      // to crash the server via `--lsp` unsupported by TypeScript <7.
      const aux = await resolveAuxConfig(sourcePath)
      if (aux !== undefined) return aux

      const configured = await resolveTsdkPathSetting(false)
      if (configured !== undefined) return configured

      const local = await resolveLocal(sourcePath, true)
      if (local !== undefined) return local

      return resolveBundled()
    }
  }
}

async function resolveAuxConfig(sourcePath: string): Promise<Binary | undefined> {
  const auxTsdkPath = await getSDKPath(path.dirname(sourcePath))
  if (auxTsdkPath === undefined) return undefined
  const pkgPath = path.join(auxTsdkPath, "package.json")
  if (await fsExists(pkgPath)) return readBinary(pkgPath)
  return undefined
}

async function resolveTsdkPathSetting(required: true): Promise<Binary>
async function resolveTsdkPathSetting(required: false): Promise<Binary | undefined>
async function resolveTsdkPathSetting(required: boolean): Promise<Binary | undefined> {
  const tsdkPath = atom.config.get("typescript-pulsar.tsdkPath")
  if (!tsdkPath) {
    if (required) {
      throw new Error(
        'typescript-pulsar.typescriptSource is set to "tsdkPath" but typescript-pulsar.tsdkPath is empty',
      )
    }
    return undefined
  }
  const pkgPath = path.join(tsdkPath, "package.json")
  if (await fsExists(pkgPath)) return readBinary(pkgPath)
  if (required) {
    throw new Error(`No TypeScript package.json found at configured tsdkPath: ${tsdkPath}`)
  }
  return undefined
}

async function resolveLocal(sourcePath: string, gateVersion: true): Promise<Binary | undefined>
async function resolveLocal(sourcePath: string, gateVersion: false): Promise<Binary>
async function resolveLocal(sourcePath: string, gateVersion: boolean): Promise<Binary | undefined> {
  const {NODE_PATH} = process.env as {NODE_PATH?: string}
  const localPath = await resolveModule("typescript/package.json", {
    basedir: path.dirname(sourcePath),
    paths: NODE_PATH !== undefined ? NODE_PATH.split(path.delimiter) : undefined,
  }).catch(() => undefined)

  if (localPath === undefined) {
    if (gateVersion) return undefined
    throw new Error(`typescript-pulsar.typescriptSource is set to "local" but no local `
      + `\`typescript\` package was found from ${sourcePath}`)
  }

  const local = await readBinary(localPath)
  if (gateVersion && !isLspCapable(local.version)) return undefined
  return local
}

// Our own dependency is aliased to "@typescript/native" (not the plain "typescript" name) so
// that our devDependencies can use the plain name for a classic-API TypeScript 6 build instead,
// which tooling that still needs ts.createProgram/ts.transpileModule (ESLint's
// typescript-eslint, ts-node) requires -- TypeScript 7's own package no longer exports that API
// at all. See AGENTS.md.
async function resolveBundled(): Promise<Binary> {
  const bundledPath = await resolveModule("@typescript/native/package.json", {basedir: __dirname})
  return readBinary(bundledPath)
}

function isLspCapable(version: string): boolean {
  return parseInt(version, 10) >= 7
}

async function readBinary(resolvedPath: string): Promise<Binary> {
  const pkg = JSON.parse(await fsReadFile(resolvedPath)) as {
    version: string
    bin?: Record<string, string>
  }
  const packageDir = path.dirname(resolvedPath)
  const binRelPath = pkg.bin?.tsc ?? "bin/tsc"

  return {
    version: pkg.version,
    pathToBin: path.join(packageDir, binRelPath),
  }
}

// Promisify the async resolve function
async function resolveModule(id: string, opts: Resolve.AsyncOpts): Promise<string> {
  return new Promise<string>((resolve, reject) =>
    Resolve(id, opts, (err, result) => {
      if (err) {
        reject(err)
      } else if (result === undefined) {
        reject(new Error("Module path is undefined"))
      } else {
        resolve(result)
      }
    }),
  )
}

async function fsExists(p: string) {
  return new Promise<boolean>((resolve) =>
    fs.access(p, fs.constants.F_OK, (err: NodeJS.ErrnoException | null) => {
      if (err) resolve(false)
      else resolve(true)
    }),
  )
}

async function fsReadFile(p: string) {
  return new Promise<string>((resolve, reject) =>
    fs.readFile(p, (error, data) => {
      if (error) reject(error)
      else resolve(data.toString("utf-8"))
    }),
  )
}

async function tryConfigFiles(basedir: string, relpaths: string[][]) {
  for (const relpath of relpaths) {
    const configFile = path.join(basedir, ...relpath)
    if (await fsExists(configFile)) return configFile
  }
}

async function resolveConfigFile(initialBaseDir: string) {
  let basedir = initialBaseDir
  let parent = path.dirname(basedir)
  while (basedir !== parent) {
    const configFile = await tryConfigFiles(basedir, [
      [".atom-typescript.json"],
      [".atom", "atom-typescript.json"],
      [".vscode", "settings.json"],
    ])
    if (configFile !== undefined) return {basedir, configFile}
    basedir = parent
    parent = path.dirname(basedir)
  }
}

function isConfigObject(x: unknown): x is ConfigObject {
  return typeof x === "object" && x !== null && typeof (x as ConfigObject).tsdkPath === "string"
}
function isVSCodeConfigObject(x: unknown): x is VSCodeConfigObject {
  return (
    typeof x === "object" &&
    x !== null &&
    typeof (x as VSCodeConfigObject)["typescript.tsdk"] === "string"
  )
}

async function getSDKPath(dirname: string) {
  const configFile = await resolveConfigFile(dirname)
  if (configFile) {
    try {
      const configFileContents = jsonc.parse(await fsReadFile(configFile.configFile)) as unknown
      let tsdkPath
      if (isConfigObject(configFileContents)) {
        tsdkPath = configFileContents.tsdkPath
      } else if (isVSCodeConfigObject(configFileContents)) {
        // NOTE: VSCode asks for path to "typescript/lib", while
        // we only want path to "typescript". Hence the dirname here
        tsdkPath = path.dirname(configFileContents["typescript.tsdk"])
      } else {
        return undefined
      }
      return path.isAbsolute(tsdkPath) ? tsdkPath : path.join(configFile.basedir, tsdkPath)
    } catch (e) {
      console.warn(e)
    }
  }
}

/** Walks up from `fromPath` looking for the nearest `tsconfig.json`. Replaces the old
 * `ts.findConfigFile`, which relied on the classic `typescript` JS API that TypeScript 7 no
 * longer exports. */
export async function findConfigFile(fromPath: string): Promise<string | undefined> {
  let dir = path.dirname(fromPath)
  let parent = path.dirname(dir)
  for (;;) {
    const candidate = path.join(dir, "tsconfig.json")
    if (await fsExists(candidate)) return candidate
    if (dir === parent) return undefined
    dir = parent
    parent = path.dirname(dir)
  }
}
