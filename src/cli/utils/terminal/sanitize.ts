const ANSI_SEQUENCE_REGEX =
  /\x1b(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\))/g
const CONTROL_CHARS_REGEX = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g

export function sanitizeTerminalOutput(text: string): string {
  if (!text) return text
  const withoutAnsi = text.replace(ANSI_SEQUENCE_REGEX, '')
  const normalized = withoutAnsi.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  return normalized.replace(CONTROL_CHARS_REGEX, '')
}
