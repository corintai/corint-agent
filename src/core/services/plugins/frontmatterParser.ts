/**
 * Frontmatter parsing utilities for custom commands
 */

import matter from 'gray-matter'
import yaml from 'js-yaml'
import type { CustomCommandFrontmatter } from './types'

/**
 * Parses frontmatter from markdown content
 * @param content - Markdown content with YAML frontmatter
 * @returns Parsed frontmatter and content
 */
export function parseFrontmatter(content: string): {
  frontmatter: CustomCommandFrontmatter
  content: string
} {
  const yamlSchema = (yaml as any).JSON_SCHEMA
  const parsed = matter(content, {
    engines: {
      yaml: {
        parse: (input: string) =>
          yaml.load(input, yamlSchema ? { schema: yamlSchema } : undefined) ??
          {},
      },
    },
  })
  return {
    frontmatter: (parsed.data ?? {}) as CustomCommandFrontmatter,
    content: parsed.content ?? '',
  }
}

/**
 * Converts unknown value to boolean
 * @param value - Value to convert
 * @returns Boolean value
 */
export function toBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false
  }
  return false
}

/**
 * Parses allowed tools from frontmatter value
 * @param value - Frontmatter value (string or array)
 * @returns Array of tool names
 */
export function parseAllowedTools(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(v => String(v).trim()).filter(Boolean)
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return []
    return trimmed
      .split(/\s+/)
      .map(v => v.trim())
      .filter(Boolean)
  }
  return []
}

/**
 * Parses max thinking tokens from frontmatter
 * @param frontmatter - Command frontmatter
 * @returns Max thinking tokens or undefined
 */
export function parseMaxThinkingTokens(
  frontmatter: CustomCommandFrontmatter,
): number | undefined {
  const raw =
    (frontmatter as any).maxThinkingTokens ??
    (frontmatter as any).max_thinking_tokens ??
    (frontmatter as any)['max-thinking-tokens'] ??
    (frontmatter as any)['max_thinking_tokens']
  if (raw === undefined || raw === null) return undefined
  const value = typeof raw === 'number' ? raw : Number(String(raw).trim())
  if (!Number.isFinite(value) || value < 0) return undefined
  return Math.floor(value)
}

/**
 * Extracts description from markdown content
 * @param markdown - Markdown content
 * @param fallback - Fallback description
 * @returns Extracted description
 */
export function extractDescriptionFromMarkdown(
  markdown: string,
  fallback: string,
): string {
  const lines = markdown.split(/\r?\n/)
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const heading = trimmed.match(/^#{1,6}\s+(.*)$/)
    if (heading?.[1]) return heading[1].trim()
    return trimmed.length > 120 ? `${trimmed.slice(0, 117)}...` : trimmed
  }
  return fallback
}
