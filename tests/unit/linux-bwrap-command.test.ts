import { describe, expect, test } from 'bun:test'
import { buildLinuxBwrapCommand } from '@utils/bun/shell'
import {
  ensureSessionTempDirExists,
  getSessionTempDir,
} from '@utils/session/sessionTempDir'

describe('Linux bwrap command construction', () => {
  test('includes TMPDIR env when write-restricted', () => {
    ensureSessionTempDirExists()
    const cmd = buildLinuxBwrapCommand({
      bwrapPath: '/usr/bin/bwrap',
      command: 'echo hi',
      needsNetworkRestriction: true,
      readConfig: { denyOnly: [] },
      writeConfig: { allowOnly: ['.'], denyWithinAllow: [] },
      enableWeakerNestedSandbox: false,
      binShellPath: '/bin/bash',
      cwd: '/work',
      homeDir: '/home/user',
    })

    expect(cmd[0]).toBe('/usr/bin/bwrap')
    expect(cmd).toContain('--unshare-net')
    expect(cmd).toContain('--die-with-parent')
    expect(cmd).toContain('--unshare-ipc')
    expect(cmd.join(' ')).toContain(`--setenv TMPDIR ${getSessionTempDir()}`)
  })
})
