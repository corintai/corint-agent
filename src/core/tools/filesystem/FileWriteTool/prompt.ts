import { FileReadTool } from '@tools/FileReadTool/FileReadTool'

export const PROMPT = `Writes a file to the local filesystem.

⚠️ REQUIRED PARAMETERS (Both are mandatory):
- file_path (string): The absolute path to the file (MUST be absolute, not relative)
- content (string): The complete content to write to the file

Usage:
- This tool will overwrite the existing file if there is one at the provided path.
- If this is an existing file, you MUST use the ${FileReadTool.name} tool first to read the file's contents. This tool will fail if you did not read the file first.
- ALWAYS prefer editing existing files in the codebase. NEVER write new files unless explicitly required.
- NEVER proactively create documentation files (*.md) or README files. Only create documentation files if explicitly requested by the User.
- For temporary/generated code (scripts, scratch files), ALWAYS write to \`$TMPDIR\` using an absolute path (not the project directory).
- Only use emojis if the user explicitly requests it. Avoid writing emojis to files unless asked.

❌ WRONG - Missing parameters:
{
  "name": "Write",
  "input": {}
}

❌ WRONG - Missing content parameter:
{
  "name": "Write",
  "input": {
    "file_path": "/path/to/file.txt"
  }
}

✅ CORRECT - All required parameters provided:
{
  "name": "Write",
  "input": {
    "file_path": "/Users/user/project/file.txt",
    "content": "Complete file content here"
  }
}`
