import type { ToolUseBlock } from '@anthropic-ai/sdk/resources/index.mjs'
import type { Tool } from '@tool'
import type { CanUseToolFn } from '@kode-types/canUseTool'
import {
  createAssistantMessage,
  createProgressMessage,
  createUserMessage,
  REJECT_MESSAGE,
} from '@utils/messages'
import { resolveToolNameAlias } from '@utils/tooling/toolNameAliases'
import { runToolUse } from './toolUseRunner'
import type {
  Message,
  UserMessage,
  AssistantMessage,
  ProgressMessage,
  ToolQueueEntry,
  ExtendedToolUseContext,
  ToolUseQueueOptions,
} from './types'

function createSyntheticToolUseErrorMessage(
  toolUseId: string,
  reason: 'user_interrupted' | 'sibling_error',
): UserMessage {
  if (reason === 'user_interrupted') {
    return createUserMessage([
      {
        type: 'tool_result',
        content: REJECT_MESSAGE,
        is_error: true,
        tool_use_id: toolUseId,
      },
    ])
  }

  return createUserMessage([
    {
      type: 'tool_result',
      content: '<tool_use_error>Sibling tool call errored</tool_use_error>',
      is_error: true,
      tool_use_id: toolUseId,
    },
  ])
}

export class ToolUseQueue {
  private toolDefinitions: Tool[]
  private canUseTool: CanUseToolFn
  private tools: ToolQueueEntry[] = []
  private toolUseContext: ExtendedToolUseContext
  private hasErrored = false
  private progressAvailableResolve: (() => void) | undefined
  private siblingToolUseIDs: Set<string>
  private shouldSkipPermissionCheck?: boolean

  constructor(options: ToolUseQueueOptions) {
    this.toolDefinitions = options.toolDefinitions
    this.canUseTool = options.canUseTool
    this.toolUseContext = options.toolUseContext
    this.siblingToolUseIDs = options.siblingToolUseIDs
    this.shouldSkipPermissionCheck = options.shouldSkipPermissionCheck
  }

  addTool(toolUse: ToolUseBlock, assistantMessage: AssistantMessage) {
    const resolvedToolName = resolveToolNameAlias(toolUse.name).resolvedName
    const toolDefinition = this.toolDefinitions.find(
      t => t.name === resolvedToolName,
    )
    const parsedInput = toolDefinition?.inputSchema.safeParse(toolUse.input)
    const isConcurrencySafe =
      toolDefinition && parsedInput?.success
        ? toolDefinition.isConcurrencySafe(parsedInput.data as any)
        : false

    this.tools.push({
      id: toolUse.id,
      block: toolUse,
      assistantMessage,
      status: 'queued',
      isConcurrencySafe,
      pendingProgress: [],
      queuedProgressEmitted: false,
    })

    void this.processQueue()
  }

  private canExecuteTool(isConcurrencySafe: boolean) {
    const executing = this.tools.filter(t => t.status === 'executing')
    return (
      executing.length === 0 ||
      (isConcurrencySafe && executing.every(t => t.isConcurrencySafe))
    )
  }

  private async processQueue() {
    for (const entry of this.tools) {
      if (entry.status !== 'queued') continue

      if (this.canExecuteTool(entry.isConcurrencySafe)) {
        await this.executeTool(entry)
      } else {
        if (!entry.queuedProgressEmitted) {
          entry.queuedProgressEmitted = true
          entry.pendingProgress.push(
            createProgressMessage(
              entry.id,
              this.siblingToolUseIDs,
              createAssistantMessage('<tool-progress>Waiting…</tool-progress>'),
              [],
              this.toolUseContext.options.tools,
            ),
          )
          if (this.progressAvailableResolve) {
            this.progressAvailableResolve()
            this.progressAvailableResolve = undefined
          }
        }

        if (!entry.isConcurrencySafe) {
          break
        }
      }
    }
  }

  private getAbortReason(): 'sibling_error' | 'user_interrupted' | null {
    if (this.hasErrored) return 'sibling_error'
    if (this.toolUseContext.abortController.signal.aborted)
      return 'user_interrupted'
    return null
  }

  private async executeTool(entry: ToolQueueEntry) {
    entry.status = 'executing'

    const results: (UserMessage | AssistantMessage)[] = []
    const contextModifiers: Array<
      (ctx: ExtendedToolUseContext) => ExtendedToolUseContext
    > = []

    const promise = (async () => {
      const abortReason = this.getAbortReason()
      if (abortReason) {
        results.push(createSyntheticToolUseErrorMessage(entry.id, abortReason))
        entry.results = results
        entry.contextModifiers = contextModifiers
        entry.status = 'completed'
        return
      }

      const generator = runToolUse(
        entry.block,
        this.siblingToolUseIDs,
        entry.assistantMessage,
        this.canUseTool,
        this.toolUseContext,
        this.shouldSkipPermissionCheck,
      )

      let toolErrored = false

      for await (const message of generator) {
        const reason = this.getAbortReason()
        if (reason && !toolErrored) {
          results.push(createSyntheticToolUseErrorMessage(entry.id, reason))
          break
        }

        if (
          message.type === 'user' &&
          Array.isArray(message.message.content) &&
          message.message.content.some(
            block => block.type === 'tool_result' && block.is_error === true,
          )
        ) {
          this.hasErrored = true
          toolErrored = true
        }

        if (message.type === 'progress') {
          entry.pendingProgress.push(message)
          if (this.progressAvailableResolve) {
            this.progressAvailableResolve()
            this.progressAvailableResolve = undefined
          }
        } else if (message.type === 'user' || message.type === 'assistant') {
          results.push(message)
          if (message.type === 'user') {
            const modifier =
              message.toolUseResult?.contextModifier?.modifyContext
            if (modifier) {
              contextModifiers.push(
                modifier as (ctx: ExtendedToolUseContext) => ExtendedToolUseContext,
              )
            }
          }
        }
      }

      entry.results = results
      entry.contextModifiers = contextModifiers
      entry.status = 'completed'

      if (!entry.isConcurrencySafe && contextModifiers.length > 0) {
        for (const modifyContext of contextModifiers) {
          this.toolUseContext = modifyContext(this.toolUseContext)
        }
      }
    })()

    entry.promise = promise
    promise.finally(() => {
      void this.processQueue()
    })
  }

  private *getCompletedResults(): Generator<Message, void> {
    let barrierExecuting = false
    for (const entry of this.tools) {
      while (entry.pendingProgress.length > 0) {
        yield entry.pendingProgress.shift()!
      }

      if (entry.status === 'yielded') continue

      if (barrierExecuting) continue

      if (entry.status === 'completed' && entry.results) {
        entry.status = 'yielded'
        for (const message of entry.results) {
          yield message
        }
      } else if (entry.status === 'executing' && !entry.isConcurrencySafe) {
        barrierExecuting = true
      }
    }
  }

  private hasPendingProgress() {
    return this.tools.some(t => t.pendingProgress.length > 0)
  }

  private hasCompletedResults() {
    return this.tools.some(t => t.status === 'completed')
  }

  private hasExecutingTools() {
    return this.tools.some(t => t.status === 'executing')
  }

  private hasUnfinishedTools() {
    return this.tools.some(t => t.status !== 'yielded')
  }

  async *getRemainingResults(): AsyncGenerator<Message, void> {
    while (this.hasUnfinishedTools()) {
      await this.processQueue()

      for (const message of this.getCompletedResults()) {
        yield message
      }

      if (
        this.hasExecutingTools() &&
        !this.hasCompletedResults() &&
        !this.hasPendingProgress()
      ) {
        const promises = this.tools
          .filter(t => t.status === 'executing' && t.promise)
          .map(t => t.promise!)

        const progressPromise = new Promise<void>(resolve => {
          this.progressAvailableResolve = resolve
        })

        if (promises.length > 0) {
          await Promise.race([...promises, progressPromise])
        }
      }
    }

    for (const message of this.getCompletedResults()) {
      yield message
    }
  }

  getUpdatedContext() {
    return this.toolUseContext
  }
}
