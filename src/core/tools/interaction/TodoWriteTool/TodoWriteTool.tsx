import { randomUUID } from 'crypto'
import { z } from 'zod'
import { Tool, ValidationResult } from '@tool'
import {
  setTodos,
  getTodos,
  TodoItem as StoredTodoItem,
} from '@utils/session/todoStorage'
import { buildTodoNumberMaps } from '@utils/session/todoTree'
import {
  getTodoRenderModel,
  TodoRenderModel,
} from '@utils/session/todoRenderModel'
import { emitReminderEvent } from '@services/systemReminder'
import { startWatchingTodoFile } from '@services/fileFreshness'
import { DESCRIPTION, PROMPT } from './prompt'

export function __getTodoRenderModelForTests(
  todos: StoredTodoItem[],
): TodoRenderModel {
  return getTodoRenderModel(todos)
}

const TodoItemSchema = z.object({
  id: z.string().min(1).optional().describe('Optional stable todo ID'),
  content: z
    .string()
    .min(1, 'Content cannot be empty')
    .describe('The task description or content'),
  status: z
    .enum(['pending', 'in_progress', 'completed'])
    .describe('Current status of the task'),
  activeForm: z
    .string()
    .min(1, 'Active form cannot be empty')
    .describe('The active form of the task (e.g., "Writing tests")'),
  parentId: z
    .string()
    .min(1)
    .optional()
    .describe('Parent todo ID for nested tasks'),
  parentPath: z
    .string()
    .min(1)
    .optional()
    .describe('Parent task number path (e.g., "2" or "2.1")'),
  parentContent: z
    .string()
    .min(1)
    .optional()
    .describe('Parent task content to attach nested tasks'),
  order: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe('Optional order for sibling tasks'),
})

const inputSchema = z.strictObject({
  todos: z.array(TodoItemSchema).describe('The updated todo list'),
  reason: z
    .string()
    .min(1)
    .optional()
    .describe('Reason for updating the todo list'),
})

type InputTodo = z.infer<typeof TodoItemSchema>
type Output =
  | {
      oldTodos: InputTodo[]
      newTodos: InputTodo[]
      agentId?: string
      changeSummary?: string
      changeReason?: string
    }
  | string

function validateTodos(todos: InputTodo[]): ValidationResult {
  const inProgressTasks = todos.filter(todo => todo.status === 'in_progress')
  if (inProgressTasks.length > 1) {
    return {
      result: false,
      errorCode: 2,
      message: 'Only one task can be in_progress at a time',
      meta: { inProgressTasks: inProgressTasks.map(t => t.content) },
    }
  }

  for (const todo of todos) {
    if (!todo.content?.trim()) {
      return {
        result: false,
        errorCode: 3,
        message: 'Todo has empty content',
      }
    }
    if (todo.id && todo.parentId && todo.id === todo.parentId) {
      return {
        result: false,
        errorCode: 6,
        message: 'Todo parentId cannot match its own id',
        meta: { todoContent: todo.content },
      }
    }
    if (!['pending', 'in_progress', 'completed'].includes(todo.status)) {
      return {
        result: false,
        errorCode: 4,
        message: `Invalid status "${todo.status}" for todo "${todo.content}"`,
        meta: { invalidStatus: todo.status },
      }
    }
    if (!todo.activeForm?.trim()) {
      return {
        result: false,
        errorCode: 5,
        message: 'Todo has empty activeForm',
        meta: { todoContent: todo.content },
      }
    }
  }

  return { result: true }
}

function generateTodoSummary(todos: StoredTodoItem[]): string {
  const stats = {
    total: todos.length,
    pending: todos.filter(t => t.status === 'pending').length,
    inProgress: todos.filter(t => t.status === 'in_progress').length,
    completed: todos.filter(t => t.status === 'completed').length,
  }

  let summary = `Updated ${stats.total} todo(s)`
  if (stats.total > 0) {
    summary += ` (${stats.pending} pending, ${stats.inProgress} in progress, ${stats.completed} completed)`
  }
  summary += '. Continue tracking your progress with the todo list.'

  return summary
}

function summarizeTodoChanges(
  previous: StoredTodoItem[],
  next: StoredTodoItem[],
): string | undefined {
  const prevById = new Map(previous.map(todo => [todo.id, todo]))
  const prevByExactSignature = new Map<string, StoredTodoItem[]>()
  const prevByContentParent = new Map<string, StoredTodoItem[]>()
  const prevByUniqueContent = new Map<string, StoredTodoItem[]>()
  const contentCounts = new Map<string, number>()

  const normalizeActiveForm = (todo: StoredTodoItem) =>
    todo.activeForm || todo.content
  const exactSignature = (todo: StoredTodoItem) =>
    `${todo.parentId || ''}|||${todo.content}|||${normalizeActiveForm(todo)}`
  const contentParentSignature = (todo: StoredTodoItem) =>
    `${todo.parentId || ''}|||${todo.content}`

  for (const todo of previous) {
    contentCounts.set(todo.content, (contentCounts.get(todo.content) ?? 0) + 1)
  }

  const pushToMap = (
    map: Map<string, StoredTodoItem[]>,
    key: string,
    todo: StoredTodoItem,
  ) => {
    const list = map.get(key) ?? []
    list.push(todo)
    map.set(key, list)
  }

  for (const todo of previous) {
    pushToMap(prevByExactSignature, exactSignature(todo), todo)
    pushToMap(prevByContentParent, contentParentSignature(todo), todo)
    if ((contentCounts.get(todo.content) ?? 0) === 1) {
      pushToMap(prevByUniqueContent, todo.content, todo)
    }
  }

  let added = 0
  let removed = 0
  let completed = 0
  let started = 0
  let reopened = 0
  let renamed = 0
  let parentChanged = 0

  const matchedPrevIds = new Set<string>()
  const pickFromMap = (
    map: Map<string, StoredTodoItem[]>,
    key: string,
  ): StoredTodoItem | undefined => {
    const list = map.get(key)
    if (!list) return undefined
    for (const candidate of list) {
      if (!matchedPrevIds.has(candidate.id)) {
        return candidate
      }
    }
    return undefined
  }

  for (const todo of next) {
    let prev = todo.id ? prevById.get(todo.id) : undefined
    if (prev && matchedPrevIds.has(prev.id)) {
      prev = undefined
    }
    if (!prev) {
      prev =
        pickFromMap(prevByExactSignature, exactSignature(todo)) ??
        pickFromMap(prevByContentParent, contentParentSignature(todo)) ??
        pickFromMap(prevByUniqueContent, todo.content)
    }

    if (!prev) {
      added++
      continue
    }

    matchedPrevIds.add(prev.id)

    if (prev.status !== todo.status) {
      if (prev.status === 'completed' && todo.status !== 'completed') {
        reopened++
      } else if (todo.status === 'completed') {
        completed++
      } else if (todo.status === 'in_progress') {
        started++
      }
    }

    if (prev.content !== todo.content) {
      renamed++
    }

    if (prev.parentId !== todo.parentId) {
      parentChanged++
    }
  }

  removed = previous.length - matchedPrevIds.size

  const parts = []
  if (completed) parts.push(`Completed ${completed}`)
  if (started) parts.push(`Started ${started}`)
  if (reopened) parts.push(`Reopened ${reopened}`)
  if (added) parts.push(`Added ${added}`)
  if (removed) parts.push(`Removed ${removed}`)
  if (renamed) parts.push(`Renamed ${renamed}`)
  if (parentChanged) parts.push(`Reparented ${parentChanged}`)

  if (parts.length === 0) return undefined
  return `Task list updated: ${parts.join(', ')}`
}

export const TodoWriteTool = {
  name: 'TodoWrite',
  async description() {
    return DESCRIPTION
  },
  async prompt() {
    return PROMPT
  },
  inputSchema,
  userFacingName() {
    return ''
  },
  async isEnabled() {
    return true
  },
  isReadOnly() {
    return false
  },
  isConcurrencySafe() {
    return false
  },
  needsPermissions() {
    return false
  },
  renderResultForAssistant() {
    return 'Todos have been modified successfully. Ensure that you continue to use the todo list to track your progress. Please proceed with the current tasks if applicable'
  },
  renderToolUseMessage(input, { verbose }) {
    return null
  },
  async validateInput({ todos }: z.infer<typeof inputSchema>) {
    const validation = validateTodos(todos)
    if (!validation.result) {
      return validation
    }
    return { result: true }
  },
  async *call({ todos, reason }: z.infer<typeof inputSchema>, context) {
    const agentId = context?.agentId

    if (agentId) {
      startWatchingTodoFile(agentId)
    }

    const previousTodos = getTodos(agentId)
    const oldTodos: InputTodo[] = previousTodos.map(todo => ({
      id: todo.id,
      content: todo.content,
      status: todo.status,
      activeForm: todo.activeForm || todo.content,
      parentId: todo.parentId,
      order: todo.order,
    }))

    const shouldClear =
      todos.length > 0 && todos.every(todo => todo.status === 'completed')

    const { numberToId } = buildTodoNumberMaps(previousTodos)

    const contentToId = new Map<string, string>()
    const contentCounts = new Map<string, number>()
    for (const todo of previousTodos) {
      const key = todo.content
      contentCounts.set(key, (contentCounts.get(key) ?? 0) + 1)
    }
    for (const todo of previousTodos) {
      if ((contentCounts.get(todo.content) ?? 0) === 1) {
        contentToId.set(todo.content, todo.id)
      }
    }

    const existingById = new Map(previousTodos.map(todo => [todo.id, todo]))

    const reusableExact = new Map<string, StoredTodoItem[]>()
    const reusableContentParent = new Map<string, StoredTodoItem[]>()
    const reusableUniqueContent = new Map<string, StoredTodoItem[]>()
    const consumedIds = new Set<string>()
    const normalizeActiveForm = (todo: {
      content?: string
      activeForm?: string
    }) => todo.activeForm || todo.content || ''
    const exactKey = (todo: {
      content?: string
      activeForm?: string
      parentId?: string
    }) =>
      `${todo.content ?? ''}|||${normalizeActiveForm(todo)}|||${todo.parentId || ''}`
    const contentParentKey = (todo: { content?: string; parentId?: string }) =>
      `${todo.content ?? ''}|||${todo.parentId || ''}`
    const pushReusable = (
      map: Map<string, StoredTodoItem[]>,
      key: string,
      todo: StoredTodoItem,
    ) => {
      const list = map.get(key) ?? []
      list.push(todo)
      map.set(key, list)
    }
    const takeReusable = (
      map: Map<string, StoredTodoItem[]>,
      key: string,
    ): StoredTodoItem | undefined => {
      const list = map.get(key)
      if (!list) return undefined
      while (list.length > 0) {
        const candidate = list.shift()
        if (!candidate) continue
        if (consumedIds.has(candidate.id)) {
          continue
        }
        consumedIds.add(candidate.id)
        return candidate
      }
      return undefined
    }

    for (const todo of previousTodos) {
      pushReusable(reusableExact, exactKey(todo), todo)
      pushReusable(reusableContentParent, contentParentKey(todo), todo)
      if ((contentCounts.get(todo.content) ?? 0) === 1) {
        pushReusable(reusableUniqueContent, todo.content, todo)
      }
    }

    const todoItems: StoredTodoItem[] = shouldClear
      ? []
      : todos.map((todo, index) => {
          const parentPath =
            typeof todo.parentPath === 'string' ? todo.parentPath.trim() : ''
          const parentContent =
            typeof todo.parentContent === 'string'
              ? todo.parentContent.trim()
              : ''
          const resolvedParentId =
            todo.parentId ||
            (parentPath ? numberToId.get(parentPath) : undefined) ||
            (parentContent ? contentToId.get(parentContent) : undefined)

          const explicitId = typeof todo.id === 'string' ? todo.id.trim() : ''
          const baseById = explicitId ? existingById.get(explicitId) : undefined
          if (baseById) {
            consumedIds.add(baseById.id)
          }
          const reused = !explicitId
            ? takeReusable(
                reusableExact,
                `${todo.content}|||${normalizeActiveForm(todo)}|||${resolvedParentId || ''}`,
              ) ??
              takeReusable(
                reusableContentParent,
                `${todo.content}|||${resolvedParentId || ''}`,
              ) ??
              takeReusable(reusableUniqueContent, todo.content)
            : undefined
          const base = baseById ?? reused

          const order =
            Number.isFinite(todo.order) && typeof todo.order === 'number'
              ? todo.order
              : base?.order ?? index

          const id = explicitId || base?.id || randomUUID()
          const parentId = resolvedParentId && resolvedParentId !== id
            ? resolvedParentId
            : undefined

          return {
            id,
            content: todo.content,
            status: todo.status,
            activeForm: todo.activeForm,
            parentId,
            order,
            priority: base?.priority ?? 'medium',
            ...(base?.createdAt ? { createdAt: base.createdAt } : {}),
          }
        })

    try {
      setTodos(todoItems, agentId)
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error occurred'

      emitReminderEvent('todo:error', {
        error: errorMessage,
        timestamp: Date.now(),
        agentId: context?.agentId || 'default',
        context: 'TodoWriteTool.call',
      })

      throw error instanceof Error ? error : new Error(errorMessage)
    }

    const storedTodos = getTodos(agentId)
    const changeSummary = summarizeTodoChanges(previousTodos, storedTodos)
    const trimmedReason =
      typeof reason === 'string' && reason.trim().length > 0
        ? reason.trim()
        : ''
    const changeReason = changeSummary
      ? trimmedReason || 'Auto-updated task list to reflect current execution state.'
      : undefined
    const hasChanged = Boolean(changeSummary)
    if (hasChanged) {
      emitReminderEvent('todo:changed', {
        previousTodos,
        newTodos: storedTodos,
        timestamp: Date.now(),
        agentId: agentId || 'default',
        changeType:
          storedTodos.length > previousTodos.length
            ? 'added'
            : storedTodos.length < previousTodos.length
              ? 'removed'
              : 'modified',
        changeSummary,
        changeReason,
      })
    }

    yield {
      type: 'result',
      data: {
        oldTodos,
        newTodos: storedTodos.map(todo => ({
          id: todo.id,
          content: todo.content,
          status: todo.status,
          activeForm: todo.activeForm || todo.content,
          parentId: todo.parentId,
          order: todo.order,
        })),
        agentId: agentId || undefined,
        changeSummary,
        changeReason,
      },
      resultForAssistant: this.renderResultForAssistant(),
    }
  },
} satisfies Tool<typeof inputSchema, Output>
