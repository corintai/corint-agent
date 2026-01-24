import { setSessionState, getSessionState } from './sessionState'
import {
  readAgentData,
  writeAgentData,
  resolveAgentId,
} from '@utils/agent/storage'
import { buildTodoTree } from './todoTree'

export interface TodoItem {
  id: string
  content: string
  status: 'pending' | 'in_progress' | 'completed'
  activeForm: string
  parentId?: string
  order?: number
  priority: 'high' | 'medium' | 'low'
  createdAt?: number
  updatedAt?: number
  tags?: string[]
  estimatedHours?: number
  previousStatus?: 'pending' | 'in_progress' | 'completed'
}

export interface TodoQuery {
  status?: TodoItem['status'][]
  priority?: TodoItem['priority'][]
  contentMatch?: string
  tags?: string[]
  dateRange?: { from?: Date; to?: Date }
}

export interface TodoStorageConfig {
  maxTodos: number
  autoArchiveCompleted: boolean
  sortBy: 'createdAt' | 'updatedAt' | 'priority' | 'status'
  sortOrder: 'asc' | 'desc'
}

const TODO_STORAGE_KEY = 'todos'
const TODO_CONFIG_KEY = 'todoConfig'
const TODO_CACHE_KEY = 'todoCache'

const DEFAULT_CONFIG: TodoStorageConfig = {
  maxTodos: 100,
  autoArchiveCompleted: false,
  sortBy: 'status',
  sortOrder: 'desc',
}

let todoCache: TodoItem[] | null = null
let cacheTimestamp = 0
const CACHE_TTL = 5000

export interface TodoMetrics {
  totalOperations: number
  cacheHits: number
  cacheMisses: number
  lastOperation: number
}

function invalidateCache(): void {
  todoCache = null
  cacheTimestamp = 0
}

function updateMetrics(operation: string, cacheHit: boolean = false): void {
  const sessionState = getSessionState() as any
  const metrics = sessionState.todoMetrics || {
    totalOperations: 0,
    cacheHits: 0,
    cacheMisses: 0,
    lastOperation: 0,
  }

  metrics.totalOperations++
  metrics.lastOperation = Date.now()

  if (cacheHit) {
    metrics.cacheHits++
  } else {
    metrics.cacheMisses++
  }

  setSessionState({
    ...sessionState,
    todoMetrics: metrics,
  })
}

export function getTodoMetrics(): TodoMetrics {
  const sessionState = getSessionState() as any
  return (
    sessionState.todoMetrics || {
      totalOperations: 0,
      cacheHits: 0,
      cacheMisses: 0,
      lastOperation: 0,
    }
  )
}

function applyParentAutoComplete(todos: TodoItem[]): TodoItem[] {
  const roots = buildTodoTree(todos)
  const byId = new Map(todos.map(todo => [todo.id, todo]))
  const updated = new Map<string, TodoItem>()

  const visit = (node: { todo: TodoItem; children: any[] }): boolean => {
    const childStatuses = node.children.map(visit)
    const childrenComplete =
      node.children.length > 0 && childStatuses.every(Boolean)

    const current = updated.get(node.todo.id) ?? byId.get(node.todo.id)!
    const currentCompleted = current.status === 'completed'

    if (childrenComplete && !currentCompleted) {
      updated.set(node.todo.id, {
        ...current,
        status: 'completed',
        previousStatus: current.status,
        updatedAt: Date.now(),
      })
      return true
    }

    if (node.children.length > 0) {
      return childrenComplete && currentCompleted
    }

    return currentCompleted
  }

  for (const root of roots) {
    visit(root)
  }

  if (updated.size === 0) return todos
  return todos.map(todo => updated.get(todo.id) ?? todo)
}

/**
 * Retrieves all todo items, optionally filtered by agent ID.
 * Uses caching for performance optimization.
 * @param agentId - Optional agent ID to filter todos
 * @returns Array of todo items
 */
export function getTodos(agentId?: string): TodoItem[] {
  const resolvedAgentId = resolveAgentId(agentId)
  const now = Date.now()

  if (agentId) {
    updateMetrics('getTodos', false)
    const agentTodos = readAgentData<TodoItem[]>(resolvedAgentId) || []

    const agentCacheKey = `todoCache_${resolvedAgentId}`

    return agentTodos.map(todo => ({
      ...todo,
      activeForm: todo.activeForm || todo.content,
    }))
  }

  if (todoCache && now - cacheTimestamp < CACHE_TTL) {
    updateMetrics('getTodos', true)
    return todoCache.map(todo => ({
      ...todo,
      activeForm: todo.activeForm || todo.content,
    }))
  }

  updateMetrics('getTodos', false)
  const sessionState = getSessionState()
  const todos = (sessionState as any)[TODO_STORAGE_KEY] || []

  todoCache = [...todos].map((todo: TodoItem) => ({
    ...todo,
    activeForm: todo.activeForm || todo.content,
  }))
  cacheTimestamp = now

  return todoCache
}

/**
 * Saves todo items to storage, with automatic timestamp updates and parent auto-completion.
 * Respects configuration limits and auto-archive settings.
 * @param todos - Array of todo items to save
 * @param agentId - Optional agent ID for agent-specific storage
 * @throws Error if todo limit is exceeded
 */
export function setTodos(todos: TodoItem[], agentId?: string): void {
  const resolvedAgentId = resolveAgentId(agentId)
  const config = getTodoConfig()
  const existingTodos = getTodos(agentId)

  if (agentId) {
    if (todos.length > config.maxTodos) {
      throw new Error(
        `Todo limit exceeded. Maximum ${config.maxTodos} todos allowed.`,
      )
    }

    let processedTodos = todos
    if (config.autoArchiveCompleted) {
      processedTodos = todos.filter(todo => todo.status !== 'completed')
    }

    const updatedTodos = applyParentAutoComplete(
      processedTodos.map((todo, index) => {
        const existingTodo = existingTodos.find(
          existing => existing.id === todo.id,
        )

        return {
          ...todo,
          activeForm: todo.activeForm || todo.content,
          order: Number.isFinite(todo.order)
            ? (todo.order as number)
            : existingTodo?.order ?? index,
          updatedAt: Date.now(),
          createdAt: todo.createdAt || Date.now(),
          previousStatus:
            existingTodo?.status !== todo.status
              ? existingTodo?.status
              : todo.previousStatus,
        }
      }),
    )

    writeAgentData(resolvedAgentId, updatedTodos)
    updateMetrics('setTodos')
    return
  }

  if (todos.length > config.maxTodos) {
    throw new Error(
      `Todo limit exceeded. Maximum ${config.maxTodos} todos allowed.`,
    )
  }

  let processedTodos = todos
  if (config.autoArchiveCompleted) {
    processedTodos = todos.filter(todo => todo.status !== 'completed')
  }

  const updatedTodos = applyParentAutoComplete(
    processedTodos.map((todo, index) => {
      const existingTodo = existingTodos.find(existing => existing.id === todo.id)

      return {
        ...todo,
        activeForm: todo.activeForm || todo.content,
        order: Number.isFinite(todo.order)
          ? (todo.order as number)
          : existingTodo?.order ?? index,
        updatedAt: Date.now(),
        createdAt: todo.createdAt || Date.now(),
        previousStatus:
          existingTodo?.status !== todo.status
            ? existingTodo?.status
            : todo.previousStatus,
      }
    }),
  )

  setSessionState({
    ...getSessionState(),
    [TODO_STORAGE_KEY]: updatedTodos,
  } as any)

  invalidateCache()
  updateMetrics('setTodos')
}

/**
 * Gets the current todo storage configuration.
 * @returns Current configuration merged with defaults
 */
export function getTodoConfig(): TodoStorageConfig {
  const sessionState = getSessionState() as any
  return { ...DEFAULT_CONFIG, ...(sessionState[TODO_CONFIG_KEY] || {}) }
}

/**
 * Updates the todo storage configuration.
 * @param config - Partial configuration to merge with current settings
 */
export function setTodoConfig(config: Partial<TodoStorageConfig>): void {
  const currentConfig = getTodoConfig()
  const newConfig = { ...currentConfig, ...config }

  setSessionState({
    ...getSessionState(),
    [TODO_CONFIG_KEY]: newConfig,
  } as any)

  if (config.sortBy || config.sortOrder) {
    const todos = getTodos()
    setTodos(todos)
  }
}

/**
 * Adds a new todo item to the list.
 * @param todo - Todo item to add (without timestamps)
 * @returns Updated array of all todos
 * @throws Error if a todo with the same ID already exists
 */
export function addTodo(
  todo: Omit<TodoItem, 'createdAt' | 'updatedAt'>,
): TodoItem[] {
  const todos = getTodos()

  if (todos.some(existing => existing.id === todo.id)) {
    throw new Error(`Todo with ID '${todo.id}' already exists`)
  }

  const newTodo: TodoItem = {
    ...todo,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }

  const updatedTodos = [...todos, newTodo]
  setTodos(updatedTodos)
  updateMetrics('addTodo')
  return updatedTodos
}

/**
 * Updates an existing todo item.
 * @param id - ID of the todo to update
 * @param updates - Partial todo data to merge
 * @returns Updated array of all todos
 * @throws Error if todo with given ID is not found
 */
export function updateTodo(id: string, updates: Partial<TodoItem>): TodoItem[] {
  const todos = getTodos()
  const existingTodo = todos.find(todo => todo.id === id)

  if (!existingTodo) {
    throw new Error(`Todo with ID '${id}' not found`)
  }

  const updatedTodos = todos.map(todo =>
    todo.id === id ? { ...todo, ...updates, updatedAt: Date.now() } : todo,
  )

  setTodos(updatedTodos)
  updateMetrics('updateTodo')
  return updatedTodos
}

/**
 * Deletes a todo item by ID.
 * @param id - ID of the todo to delete
 * @returns Updated array of remaining todos
 * @throws Error if todo with given ID is not found
 */
export function deleteTodo(id: string): TodoItem[] {
  const todos = getTodos()
  const todoExists = todos.some(todo => todo.id === id)

  if (!todoExists) {
    throw new Error(`Todo with ID '${id}' not found`)
  }

  const updatedTodos = todos.filter(todo => todo.id !== id)
  setTodos(updatedTodos)
  updateMetrics('deleteTodo')
  return updatedTodos
}

/**
 * Clears all todo items from storage.
 */
export function clearTodos(): void {
  setTodos([])
  updateMetrics('clearTodos')
}

/**
 * Retrieves a single todo item by ID.
 * @param id - ID of the todo to find
 * @returns The todo item or undefined if not found
 */
export function getTodoById(id: string): TodoItem | undefined {
  const todos = getTodos()
  updateMetrics('getTodoById')
  return todos.find(todo => todo.id === id)
}

/**
 * Retrieves all todos with a specific status.
 * @param status - Status to filter by ('pending', 'in_progress', or 'completed')
 * @returns Array of matching todos
 */
export function getTodosByStatus(status: TodoItem['status']): TodoItem[] {
  const todos = getTodos()
  updateMetrics('getTodosByStatus')
  return todos.filter(todo => todo.status === status)
}

/**
 * Retrieves all todos with a specific priority.
 * @param priority - Priority to filter by ('high', 'medium', or 'low')
 * @returns Array of matching todos
 */
export function getTodosByPriority(priority: TodoItem['priority']): TodoItem[] {
  const todos = getTodos()
  updateMetrics('getTodosByPriority')
  return todos.filter(todo => todo.priority === priority)
}

/**
 * Queries todos with multiple filter criteria.
 * @param query - Query object with optional filters for status, priority, content, tags, and date range
 * @returns Array of todos matching all specified criteria
 */
export function queryTodos(query: TodoQuery): TodoItem[] {
  const todos = getTodos()
  updateMetrics('queryTodos')

  return todos.filter(todo => {
    if (query.status && !query.status.includes(todo.status)) {
      return false
    }

    if (query.priority && !query.priority.includes(todo.priority)) {
      return false
    }

    if (
      query.contentMatch &&
      !todo.content.toLowerCase().includes(query.contentMatch.toLowerCase())
    ) {
      return false
    }

    if (query.tags && todo.tags) {
      const hasMatchingTag = query.tags.some(tag => todo.tags!.includes(tag))
      if (!hasMatchingTag) return false
    }

    if (query.dateRange) {
      const todoDate = new Date(todo.createdAt || 0)
      if (query.dateRange.from && todoDate < query.dateRange.from) return false
      if (query.dateRange.to && todoDate > query.dateRange.to) return false
    }

    return true
  })
}

export function getTodoStatistics() {
  const todos = getTodos()
  const metrics = getTodoMetrics()

  return {
    total: todos.length,
    byStatus: {
      pending: todos.filter(t => t.status === 'pending').length,
      in_progress: todos.filter(t => t.status === 'in_progress').length,
      completed: todos.filter(t => t.status === 'completed').length,
    },
    byPriority: {
      high: todos.filter(t => t.priority === 'high').length,
      medium: todos.filter(t => t.priority === 'medium').length,
      low: todos.filter(t => t.priority === 'low').length,
    },
    metrics,
    cacheEfficiency:
      metrics.totalOperations > 0
        ? Math.round((metrics.cacheHits / metrics.totalOperations) * 100)
        : 0,
  }
}

export function optimizeTodoStorage(): void {
  invalidateCache()

  const todos = getTodos()
  const validTodos = todos.filter(
    todo =>
      todo.id &&
      todo.content &&
      todo.activeForm &&
      ['pending', 'in_progress', 'completed'].includes(todo.status) &&
      ['high', 'medium', 'low'].includes(todo.priority),
  )

  if (validTodos.length !== todos.length) {
    setTodos(validTodos)
  }

  updateMetrics('optimizeTodoStorage')
}
