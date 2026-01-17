#!/usr/bin/env node

const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

function findPackageRoot(startDir) {
  let dir = startDir
  for (let i = 0; i < 25; i++) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return startDir
}

function run(cmd, args) {
  const result = spawnSync(cmd, args, {
    stdio: 'inherit',
    env: { ...process.env, CORINT_PACKAGED: process.env.CORINT_PACKAGED || '1' },
  })
  if (result.error) {
    throw result.error
  }
  process.exit(typeof result.status === 'number' ? result.status : 1)
}

function main() {
  const packageRoot = findPackageRoot(__dirname)
  const distEntry = path.join(packageRoot, 'dist', 'acp.js')

  if (fs.existsSync(distEntry)) {
    run(process.execPath, [distEntry, ...process.argv.slice(2)])
  }

  process.stderr.write(
    [
      '❌ ACP entrypoint is not runnable on this system.',
      '',
      'Tried:',
      '- Node.js runtime fallback',
      '',
      'Fix:',
      '- Run `bun run build:npm` to generate dist/acp.js',
      '',
    ].join('\n'),
  )
  process.exit(1)
}

main()
