import { existsSync, readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import matter from 'gray-matter'
import yaml from 'js-yaml'

export function listMarkdownFilesRecursively(rootDir: string): string[] {
  const files: string[] = []
  const visitedDirs = new Set<string>()

  const walk = (dirPath: string) => {
    let dirStat: ReturnType<typeof statSync>
    try {
      dirStat = statSync(dirPath)
    } catch {
      return
    }
    if (!dirStat.isDirectory()) return

    const dirKey = `${dirStat.dev}:${dirStat.ino}`
    if (visitedDirs.has(dirKey)) return
    visitedDirs.add(dirKey)

    let entries: Array<{
      name: string
      isDirectory(): boolean
      isFile(): boolean
      isSymbolicLink(): boolean
    }>
    try {
      entries = readdirSync(dirPath, {
        withFileTypes: true,
        encoding: 'utf8',
      }) as any
    } catch {
      return
    }

    for (const entry of entries) {
      const name = String(entry.name ?? '')
      const fullPath = join(dirPath, name)

      if (entry.isDirectory()) {
        walk(fullPath)
        continue
      }

      if (entry.isFile()) {
        if (name.endsWith('.md')) files.push(fullPath)
        continue
      }

      if (entry.isSymbolicLink()) {
        try {
          const st = statSync(fullPath)
          if (st.isDirectory()) {
            walk(fullPath)
          } else if (st.isFile() && name.endsWith('.md')) {
            files.push(fullPath)
          }
        } catch {
          continue
        }
      }
    }
  }

  if (!existsSync(rootDir)) return []
  walk(rootDir)
  return files
}

export function readMarkdownFile(
  filePath: string,
): { frontmatter: any; content: string } | null {
  try {
    const raw = readFileSync(filePath, 'utf8')
    const yamlSchema = (yaml as any).JSON_SCHEMA
    const matterOptions = {
      engines: {
        yaml: {
          parse: (input: string) =>
            yaml.load(input, yamlSchema ? { schema: yamlSchema } : undefined) ??
            {},
        },
      },
    }
    const parsed = matter(raw, matterOptions as any)
    return {
      frontmatter: parsed.data ?? {},
      content: parsed.content ?? '',
    }
  } catch {
    return null
  }
}
