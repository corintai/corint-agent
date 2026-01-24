import { statSync } from 'fs'
import { createRequire } from 'node:module'
import { extname, join } from 'path'
import { pathToFileURL } from 'url'

export type TypeScriptModule = typeof import('typescript')

let cachedTypeScript: { cwd: string; module: TypeScriptModule | null } | null =
  null

export function tryLoadTypeScriptModule(
  projectCwd: string,
): TypeScriptModule | null {
  if (cachedTypeScript?.cwd === projectCwd) return cachedTypeScript.module

  try {
    const requireFromCwd = createRequire(
      pathToFileURL(join(projectCwd, '__kode_lsp__.js')),
    )
    const mod = requireFromCwd('typescript') as TypeScriptModule
    cachedTypeScript = { cwd: projectCwd, module: mod }
    return mod
  } catch {
    cachedTypeScript = { cwd: projectCwd, module: null }
    return null
  }
}

export type TsProjectState = {
  ts: TypeScriptModule
  cwd: string
  rootFiles: Set<string>
  compilerOptions: any
  languageService: any
  versions: Map<string, string>
}

const projectCache = new Map<string, TsProjectState>()

export function getOrCreateTsProject(
  projectCwd: string,
): TsProjectState | null {
  const ts = tryLoadTypeScriptModule(projectCwd)
  if (!ts) return null

  const existing = projectCache.get(projectCwd)
  if (existing) return existing

  let compilerOptions: any = {
    allowJs: true,
    checkJs: false,
    jsx: ts.JsxEmit.ReactJSX,
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
  }

  let rootFileNames: string[] = []
  try {
    const configPath = ts.findConfigFile(
      projectCwd,
      ts.sys.fileExists,
      'tsconfig.json',
    )
    if (configPath) {
      const configFile = ts.readConfigFile(configPath, ts.sys.readFile)
      if (!configFile.error) {
        const parsed = ts.parseJsonConfigFileContent(
          configFile.config,
          ts.sys,
          projectCwd,
        )
        compilerOptions = { ...compilerOptions, ...parsed.options }
        rootFileNames = parsed.fileNames
      }
    }
  } catch {}

  const rootFiles = new Set(rootFileNames)
  const versions = new Map<string, string>()

  const host: any = {
    getCompilationSettings: () => compilerOptions,
    getScriptFileNames: () => Array.from(rootFiles),
    getScriptVersion: (fileName: string) => {
      try {
        const stat = statSync(fileName)
        const version = String(stat.mtimeMs ?? Date.now())
        versions.set(fileName, version)
        return version
      } catch {
        return versions.get(fileName) ?? '0'
      }
    },
    getScriptSnapshot: (fileName: string) => {
      try {
        if (!ts.sys.fileExists(fileName)) return undefined
        const content = ts.sys.readFile(fileName)
        if (content === undefined) return undefined
        const stat = statSync(fileName)
        versions.set(fileName, String(stat.mtimeMs ?? Date.now()))
        return ts.ScriptSnapshot.fromString(content)
      } catch {
        return undefined
      }
    },
    getCurrentDirectory: () => projectCwd,
    getDefaultLibFileName: (options: any) => ts.getDefaultLibFilePath(options),
    fileExists: ts.sys.fileExists,
    readFile: ts.sys.readFile,
    readDirectory: ts.sys.readDirectory,
    directoryExists: ts.sys.directoryExists,
    getDirectories: ts.sys.getDirectories,
    useCaseSensitiveFileNames: () => ts.sys.useCaseSensitiveFileNames,
    getCanonicalFileName: (fileName: string) =>
      ts.sys.useCaseSensitiveFileNames ? fileName : fileName.toLowerCase(),
    getNewLine: () => ts.sys.newLine,
  }

  const languageService = ts.createLanguageService(
    host,
    ts.createDocumentRegistry(),
  )

  const state: TsProjectState = {
    ts,
    cwd: projectCwd,
    rootFiles,
    compilerOptions,
    languageService,
    versions,
  }
  projectCache.set(projectCwd, state)
  return state
}

export function isFileTypeSupportedByTypescriptBackend(
  filePath: string,
): boolean {
  const ext = extname(filePath).toLowerCase()
  return (
    ext === '.ts' ||
    ext === '.tsx' ||
    ext === '.js' ||
    ext === '.jsx' ||
    ext === '.mts' ||
    ext === '.cts' ||
    ext === '.mjs' ||
    ext === '.cjs'
  )
}
