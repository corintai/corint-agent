import { z } from 'zod'

export type Operation =
  | 'goToDefinition'
  | 'findReferences'
  | 'hover'
  | 'documentSymbol'
  | 'workspaceSymbol'
  | 'goToImplementation'
  | 'prepareCallHierarchy'
  | 'incomingCalls'
  | 'outgoingCalls'

export const inputSchema = z.strictObject({
  operation: z
    .enum([
      'goToDefinition',
      'findReferences',
      'hover',
      'documentSymbol',
      'workspaceSymbol',
      'goToImplementation',
      'prepareCallHierarchy',
      'incomingCalls',
      'outgoingCalls',
    ])
    .describe('The LSP operation to perform'),
  filePath: z.string().describe('The absolute or relative path to the file'),
  line: z
    .number()
    .int()
    .positive()
    .describe('The line number (1-based, as shown in editors)'),
  character: z
    .number()
    .int()
    .positive()
    .describe('The character offset (1-based, as shown in editors)'),
})

export const outputSchema = z.object({
  operation: z
    .enum([
      'goToDefinition',
      'findReferences',
      'hover',
      'documentSymbol',
      'workspaceSymbol',
      'goToImplementation',
      'prepareCallHierarchy',
      'incomingCalls',
      'outgoingCalls',
    ])
    .describe('The LSP operation that was performed'),
  result: z.string().describe('The formatted result of the LSP operation'),
  filePath: z.string().describe('The file path the operation was performed on'),
  resultCount: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe('Number of results (definitions, references, symbols)'),
  fileCount: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe('Number of files containing results'),
})

export type Input = z.infer<typeof inputSchema>
export type Output = z.infer<typeof outputSchema>
