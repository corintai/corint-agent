import { existsSync } from 'fs'

export function getShellCmdForPlatform(
  platform: NodeJS.Platform,
  command: string,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  if (platform === 'win32') {
    const comspec =
      typeof env.ComSpec === 'string' && env.ComSpec.length > 0
        ? env.ComSpec
        : 'cmd'
    return [comspec, '/c', command]
  }
  const sh = existsSync('/bin/sh') ? '/bin/sh' : 'sh'
  return [sh, '-c', command]
}

export function getShellCmd(command: string): string[] {
  return getShellCmdForPlatform(process.platform, command, process.env)
}
