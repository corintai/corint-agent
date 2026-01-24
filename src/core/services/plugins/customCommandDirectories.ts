import { existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { getCwd } from '@utils/state'
import { getCorintBaseDir } from '@utils/config/env'

export function getCustomCommandDirectories(): {
  userClaudeCommands: string
  projectClaudeCommands: string
  userClaudeSkills: string
  projectClaudeSkills: string
  userCorintCommands: string
  projectCorintCommands: string
  userCorintSkills: string
  projectCorintSkills: string
} {
  const userCorintBaseDir = getCorintBaseDir()
  return {
    userClaudeCommands: join(homedir(), '.claude', 'commands'),
    projectClaudeCommands: join(getCwd(), '.claude', 'commands'),
    userClaudeSkills: join(homedir(), '.claude', 'skills'),
    projectClaudeSkills: join(getCwd(), '.claude', 'skills'),
    userCorintCommands: join(userCorintBaseDir, 'commands'),
    projectCorintCommands: join(getCwd(), '.corint', 'commands'),
    userCorintSkills: join(userCorintBaseDir, 'skills'),
    projectCorintSkills: join(getCwd(), '.corint', 'skills'),
  }
}

export function hasCustomCommands(): boolean {
  const dirs = getCustomCommandDirectories()
  return (
    existsSync(dirs.userClaudeCommands) ||
    existsSync(dirs.projectClaudeCommands) ||
    existsSync(dirs.userClaudeSkills) ||
    existsSync(dirs.projectClaudeSkills) ||
    existsSync(dirs.userCorintCommands) ||
    existsSync(dirs.projectCorintCommands) ||
    existsSync(dirs.userCorintSkills) ||
    existsSync(dirs.projectCorintSkills)
  )
}
