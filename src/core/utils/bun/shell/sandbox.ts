import { existsSync, realpathSync, statSync } from 'fs'
import { homedir } from 'os'
import { dirname, isAbsolute, resolve } from 'path'
import {
  ensureSessionTempDirExists,
  getSessionTempDir,
} from '@utils/session/sessionTempDir'
import type {
  BunShellSandboxOptions,
  BunShellSandboxReadConfig,
  BunShellSandboxWriteConfig,
} from './types'
import { whichOrSelf, whichSync } from './process'

export function maybeAnnotateMacosSandboxStderr(
  stderr: string,
  sandbox: BunShellSandboxOptions | undefined,
): string {
  if (!stderr) return stderr
  if (!sandbox || sandbox.enabled !== true) return stderr
  const platform = sandbox.__platformOverride ?? process.platform
  if (platform !== 'darwin') return stderr
  if (stderr.includes('[sandbox]')) return stderr

  const lower = stderr.toLowerCase()
  const looksLikeSandboxViolation =
    stderr.includes('CORINT_SANDBOX') ||
    (lower.includes('sandbox-exec') &&
      (lower.includes('deny') || lower.includes('operation not permitted'))) ||
    (lower.includes('operation not permitted') && lower.includes('sandbox'))

  if (!looksLikeSandboxViolation) return stderr

  return [
    stderr.trimEnd(),
    '',
    '[sandbox] This failure looks like a macOS sandbox denial. Adjust sandbox settings (e.g. /sandbox or .corint/settings.json) to grant the minimal required access.',
  ].join('\n')
}

function hasGlobPattern(value: string): boolean {
  return (
    value.includes('*') ||
    value.includes('?') ||
    value.includes('[') ||
    value.includes(']')
  )
}

export function normalizeLinuxSandboxPath(
  input: string,
  options?: { cwd?: string; homeDir?: string },
): string {
  const cwd = options?.cwd ?? process.cwd()
  const homeDir = options?.homeDir ?? homedir()

  let resolved = input
  if (input === '~') resolved = homeDir
  else if (input.startsWith('~/')) resolved = homeDir + input.slice(1)
  else if (input.startsWith('./') || input.startsWith('../'))
    resolved = resolve(cwd, input)
  else if (!isAbsolute(input)) resolved = resolve(cwd, input)

  if (hasGlobPattern(resolved)) {
    const prefix = resolved.split(/[*?[\]]/)[0]
    if (prefix && prefix !== '/') {
      const dir = prefix.endsWith('/') ? prefix.slice(0, -1) : dirname(prefix)
      try {
        const real = realpathSync(dir)
        const suffix = resolved.slice(dir.length)
        return real + suffix
      } catch {}
    }
    return resolved
  }

  try {
    resolved = realpathSync(resolved)
  } catch {}

  return resolved
}

export function buildLinuxBwrapFilesystemArgs(options: {
  cwd?: string
  homeDir?: string
  readConfig?: BunShellSandboxReadConfig
  writeConfig?: BunShellSandboxWriteConfig
  extraDenyWithinAllow?: string[]
}): string[] {
  const cwd = options.cwd ?? process.cwd()
  const homeDir = options.homeDir ?? homedir()

  const args: string[] = []

  const writeConfig = options.writeConfig
  if (writeConfig) {
    args.push('--ro-bind', '/', '/')

    const allowedRoots: string[] = []

    for (const raw of writeConfig.allowOnly ?? []) {
      const resolved = normalizeLinuxSandboxPath(raw, { cwd, homeDir })
      if (resolved.startsWith('/dev/')) continue
      if (!existsSync(resolved)) continue
      args.push('--bind', resolved, resolved)
      allowedRoots.push(resolved)
    }

    const denyWithinAllow = [
      ...(writeConfig.denyWithinAllow ?? []),
      ...(options.extraDenyWithinAllow ?? []),
    ]
    for (const raw of denyWithinAllow) {
      const resolved = normalizeLinuxSandboxPath(raw, { cwd, homeDir })
      if (resolved.startsWith('/dev/')) continue
      if (!existsSync(resolved)) continue
      const withinAllowed = allowedRoots.some(
        root => resolved === root || resolved.startsWith(root + '/'),
      )
      if (!withinAllowed) continue
      args.push('--ro-bind', resolved, resolved)
    }
  } else {
    args.push('--bind', '/', '/')
  }

  const denyRead = [...(options.readConfig?.denyOnly ?? [])]
  if (existsSync('/etc/ssh/ssh_config.d'))
    denyRead.push('/etc/ssh/ssh_config.d')

  for (const raw of denyRead) {
    const resolved = normalizeLinuxSandboxPath(raw, { cwd, homeDir })
    if (resolved.startsWith('/dev/')) continue
    if (!existsSync(resolved)) continue
    if (statSync(resolved).isDirectory()) args.push('--tmpfs', resolved)
    else args.push('--ro-bind', '/dev/null', resolved)
  }

  return args
}

export function buildLinuxBwrapCommand(options: {
  bwrapPath: string
  command: string
  needsNetworkRestriction?: boolean
  readConfig?: BunShellSandboxReadConfig
  writeConfig?: BunShellSandboxWriteConfig
  enableWeakerNestedSandbox?: boolean
  binShellPath: string
  tmpDir?: string
  cwd?: string
  homeDir?: string
}): string[] {
  const args: string[] = []

  args.push(
    '--die-with-parent',
    '--new-session',
    '--unshare-pid',
    '--unshare-uts',
    '--unshare-ipc',
  )
  if (options.needsNetworkRestriction) args.push('--unshare-net')

  if (options.tmpDir) {
    args.push('--tmpfs', options.tmpDir)
  }

  if (!options.enableWeakerNestedSandbox) {
    args.push('--unshare-cgroup')
  }

  if (options.cwd) {
    args.push('--chdir', options.cwd)
  }

  args.push(
    '--ro-bind',
    '/bin',
    '/bin',
    '--ro-bind',
    '/usr',
    '/usr',
    '--ro-bind',
    '/lib',
    '/lib',
    '--ro-bind',
    '/lib64',
    '/lib64',
  )

  args.push(
    ...buildLinuxBwrapFilesystemArgs({
      cwd: options.cwd,
      homeDir: options.homeDir,
      readConfig: options.readConfig,
      writeConfig: options.writeConfig,
      extraDenyWithinAllow: options.cwd ? [options.cwd] : undefined,
    }),
  )

  args.push('--proc', '/proc', '--dev', '/dev')

  return [
    options.bwrapPath,
    ...args,
    options.binShellPath,
    '-c',
    options.command,
  ]
}

function buildSandboxEnvAssignments(options?: {
  enableWeakerNestedSandbox?: boolean
  allowLocalBinding?: boolean
  needsNetworkRestriction?: boolean
  httpProxyPort?: number
  socksProxyPort?: number
}): string[] {
  const envAssignments = []
  envAssignments.push(`CORINT_SANDBOX=1`)
  envAssignments.push(
    `CORINT_SANDBOX_ALLOW_LOCAL=${options?.allowLocalBinding ? '1' : '0'}`,
  )
  envAssignments.push(
    `CORINT_SANDBOX_NO_NETWORK=${options?.needsNetworkRestriction ? '1' : '0'}`,
  )
  if (options?.enableWeakerNestedSandbox)
    envAssignments.push(`CORINT_SANDBOX_WEAK_NESTED=1`)
  if (options?.httpProxyPort)
    envAssignments.push(`CORINT_SANDBOX_HTTP_PROXY=${options.httpProxyPort}`)
  if (options?.socksProxyPort)
    envAssignments.push(`CORINT_SANDBOX_SOCKS_PROXY=${options.socksProxyPort}`)
  return envAssignments
}

function escapeRegexForSandboxGlobPattern(pattern: string): string {
  return pattern
    .replace(/\\/g, '\\\\')
    .replace(/\./g, '\\.')
    .replace(/\//g, '\\/')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
}

function getMacosTmpDirWriteAllowPaths(): string[] {
  const tmpDirs = ['TMPDIR', 'TEMP', 'TMP']
    .map(env => process.env[env])
    .filter(Boolean)
  if (tmpDirs.length === 0) tmpDirs.push('/tmp')
  return tmpDirs.filter(Boolean) as string[]
}

function buildMacosSandboxDenyUnlinkRules(
  denyPaths: string[],
  logTag: string,
): string[] {
  const rules = []
  for (const raw of denyPaths) {
    const normalized = normalizeLinuxSandboxPath(raw)
    if (!normalized || normalized === '/') continue
    if (normalized.startsWith('/dev/')) continue
    const regex = escapeRegexForSandboxGlobPattern(normalized)
    rules.push(`(deny file-unlink (regex "^${regex}($|/)" ) (${logTag}))`)
  }
  return rules
}

function buildMacosSandboxFileReadRules(
  readConfig: BunShellSandboxReadConfig | undefined,
  logTag: string,
): string[] {
  if (!readConfig) return []

  const rules = []
  const denyPaths = readConfig.denyOnly ?? []
  for (const raw of denyPaths) {
    const normalized = normalizeLinuxSandboxPath(raw)
    if (!normalized || normalized === '/') continue
    if (normalized.startsWith('/dev/')) continue
    const regex = escapeRegexForSandboxGlobPattern(normalized)
    rules.push(`(deny file-read* (regex "^${regex}($|/)" ) (${logTag}))`)
  }

  rules.push(
    ...buildMacosSandboxDenyUnlinkRules(readConfig.denyOnly ?? [], logTag),
  )
  return rules
}

function buildMacosSandboxFileWriteRules(
  writeConfig: BunShellSandboxWriteConfig | undefined,
  logTag: string,
): string[] {
  if (!writeConfig) return []

  const rules = []
  const allowRoots = writeConfig.allowOnly ?? []
  const denyWithinAllow = writeConfig.denyWithinAllow ?? []

  for (const raw of getMacosTmpDirWriteAllowPaths()) {
    allowRoots.push(raw)
  }

  for (const raw of allowRoots) {
    const normalized = normalizeLinuxSandboxPath(raw)
    if (!normalized || normalized === '/') continue
    if (normalized.startsWith('/dev/')) continue
    const regex = escapeRegexForSandboxGlobPattern(normalized)
    rules.push(`(allow file-write* (regex "^${regex}($|/)" ) (${logTag}))`)
  }

  for (const raw of denyWithinAllow) {
    const normalized = normalizeLinuxSandboxPath(raw)
    if (!normalized || normalized === '/') continue
    if (normalized.startsWith('/dev/')) continue
    const regex = escapeRegexForSandboxGlobPattern(normalized)
    rules.push(`(deny file-write* (regex "^${regex}($|/)" ) (${logTag}))`)
  }

  rules.push(
    ...buildMacosSandboxDenyUnlinkRules(
      writeConfig.denyWithinAllow ?? [],
      logTag,
    ),
  )

  return rules
}

export function buildMacosSandboxExecCommand(options: {
  sandboxExecPath: string
  binShellPath: string
  command: string
  needsNetworkRestriction?: boolean
  httpProxyPort?: number
  socksProxyPort?: number
  allowUnixSockets?: string[]
  allowAllUnixSockets?: boolean
  allowLocalBinding?: boolean
  readConfig?: BunShellSandboxReadConfig
  writeConfig?: BunShellSandboxWriteConfig
  tmpDir?: string
}): string[] {
  const logTag = 'corint-sandbox'

  const rules: string[] = []

  rules.push(`(version 1)`)
  rules.push(`(deny default)`)

  rules.push(`(allow file-read* (regex "^/dev/") (${logTag}))`)
  rules.push(`(allow file-read* (regex "^/System/") (${logTag}))`)
  rules.push(`(allow file-read* (regex "^/Library/") (${logTag}))`)
  rules.push(`(allow file-read* (regex "^/usr/") (${logTag}))`)
  rules.push(`(allow file-read* (regex "^/bin/") (${logTag}))`)
  rules.push(`(allow file-read* (regex "^/sbin/") (${logTag}))`)

  rules.push(`(allow file-read* (regex "^/etc/") (${logTag}))`)
  rules.push(`(allow file-read* (regex "^/private/etc/") (${logTag}))`)

  if (!options.needsNetworkRestriction) {
    rules.push(`(allow network-outbound (${logTag}))`)
    rules.push(`(allow network-inbound (${logTag}))`)
  } else {
    if (options.allowLocalBinding) {
      rules.push(`(allow network-inbound (local ip) (${logTag}))`)
    }
  }

  if (options.allowAllUnixSockets) {
    rules.push(`(allow unix-socket* (${logTag}))`)
  } else if (options.allowUnixSockets && options.allowUnixSockets.length > 0) {
    for (const socket of options.allowUnixSockets) {
      const normalized = normalizeLinuxSandboxPath(socket)
      if (!normalized || normalized === '/') continue
      const regex = escapeRegexForSandboxGlobPattern(normalized)
      rules.push(`(allow unix-socket* (regex "^${regex}($|/)" ) (${logTag}))`)
    }
  }

  rules.push(`(allow file-write* (subpath "/dev/fd") (${logTag}))`)
  rules.push(`(allow file-write* (subpath "/dev/null") (${logTag}))`)
  rules.push(`(allow file-write* (subpath "/dev/tty") (${logTag}))`)
  rules.push(`(allow file-write* (subpath "/dev/stdout") (${logTag}))`)
  rules.push(`(allow file-write* (subpath "/dev/stderr") (${logTag}))`)

  if (options.tmpDir) {
    rules.push(`(allow file-write* (subpath "${options.tmpDir}") (${logTag}))`)
  }

  rules.push(...buildMacosSandboxFileReadRules(options.readConfig, logTag))
  rules.push(...buildMacosSandboxFileWriteRules(options.writeConfig, logTag))

  const envAssignments = buildSandboxEnvAssignments({
    enableWeakerNestedSandbox: options.writeConfig?.allowOnly?.includes('/'),
    allowLocalBinding: options.allowLocalBinding,
    needsNetworkRestriction: options.needsNetworkRestriction,
    httpProxyPort: options.httpProxyPort,
    socksProxyPort: options.socksProxyPort,
  })

  return [
    options.sandboxExecPath,
    '-p',
    rules.join('\n'),
    options.binShellPath,
    '-c',
    `${envAssignments.join(' ')} ${options.command}`,
  ]
}

export function buildSandboxCmd(
  command: string,
  sandbox: BunShellSandboxOptions,
  defaultCwd: string,
): { cmd: string[]; warning?: string } | null {
  if (!sandbox.enabled) return null
  const platform = sandbox.__platformOverride ?? process.platform

  const needsNetworkRestriction =
    sandbox.needsNetworkRestriction !== undefined
      ? sandbox.needsNetworkRestriction
      : sandbox.allowNetwork === true
        ? false
        : true

  const writeConfig: BunShellSandboxWriteConfig | undefined =
    sandbox.writeConfig ??
    (sandbox.writableRoots && sandbox.writableRoots.length > 0
      ? { allowOnly: sandbox.writableRoots.filter(Boolean) }
      : undefined)

  const readConfig = sandbox.readConfig

  const hasReadRestrictions = (readConfig?.denyOnly?.length ?? 0) > 0
  const hasWriteRestrictions = writeConfig !== undefined
  const hasNetworkRestrictions = needsNetworkRestriction === true

  if (
    !hasReadRestrictions &&
    !hasWriteRestrictions &&
    !hasNetworkRestrictions
  ) {
    return null
  }

  const binShell = sandbox.binShell ?? (whichSync('bash') ? 'bash' : 'sh')
  const binShellPath = whichOrSelf(binShell)

  const cwd = sandbox.chdir || defaultCwd

  if (platform === 'linux') {
    const bwrapPath =
      sandbox.__bwrapPathOverride !== undefined
        ? sandbox.__bwrapPathOverride
        : (whichSync('bwrap') ?? whichSync('bubblewrap'))
    if (!bwrapPath) {
      return null
    }

    ensureSessionTempDirExists()
    const tmpDir = getSessionTempDir()

    const cmd = buildLinuxBwrapCommand({
      bwrapPath,
      command,
      needsNetworkRestriction,
      readConfig,
      writeConfig,
      enableWeakerNestedSandbox: sandbox.enableWeakerNestedSandbox,
      binShellPath,
      tmpDir,
      cwd,
    })

    return { cmd }
  }

  if (platform === 'darwin') {
    const sandboxExecPath =
      sandbox.__sandboxExecPathOverride !== undefined
        ? sandbox.__sandboxExecPathOverride
        : existsSync('/usr/bin/sandbox-exec')
          ? '/usr/bin/sandbox-exec'
          : whichSync('sandbox-exec')
    if (!sandboxExecPath) {
      return null
    }

    ensureSessionTempDirExists()
    const tmpDir = getSessionTempDir()

    return {
      cmd: buildMacosSandboxExecCommand({
        sandboxExecPath,
        binShellPath,
        command,
        needsNetworkRestriction,
        httpProxyPort: sandbox.httpProxyPort,
        socksProxyPort: sandbox.socksProxyPort,
        allowUnixSockets: sandbox.allowUnixSockets,
        allowAllUnixSockets: sandbox.allowAllUnixSockets,
        allowLocalBinding: sandbox.allowLocalBinding,
        readConfig,
        writeConfig,
        tmpDir,
      }),
    }
  }

  return null
}

export function isSandboxInitFailure(stderr: string): boolean {
  const s = stderr.toLowerCase()
  return (
    s.includes('bwrap:') ||
    s.includes('bubblewrap') ||
    (s.includes('namespace') && s.includes('failed'))
  )
}
