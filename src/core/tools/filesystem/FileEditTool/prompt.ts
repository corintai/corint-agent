export const DESCRIPTION = `Performs exact string replacements in files.

⚠️ REQUIRED PARAMETERS (All three are mandatory):
- file_path (string): The absolute path to the file (MUST be absolute, not relative)
- old_string (string): The exact text to replace (must match exactly)
- new_string (string): The replacement text

Usage:
- You must use your \`Read\` tool at least once in the conversation before editing. This tool will error if you attempt an edit without reading the file. 
- When editing text from Read tool output, ensure you preserve the exact indentation (tabs/spaces) as it appears AFTER the line number prefix. The line number prefix format is: spaces + line number + tab. Everything after that tab is the actual file content to match. Never include any part of the line number prefix in the old_string or new_string.
- ALWAYS prefer editing existing files in the codebase. NEVER write new files unless explicitly required.
- Only use emojis if the user explicitly requests it. Avoid adding emojis to files unless asked.
- The edit will FAIL if \`old_string\` is not unique in the file. Either provide a larger string with more surrounding context to make it unique or use \`replace_all\` to change every instance of \`old_string\`. 
- Use \`replace_all\` for replacing and renaming strings across the file. This parameter is useful if you want to rename a variable for instance.

✅ CORRECT - All required parameters provided:
{
  "name": "Edit",
  "input": {
    "file_path": "/Users/user/project/file.txt",
    "old_string": "const foo = 'bar'",
    "new_string": "const foo = 'baz'"
  }
}`.trim()
