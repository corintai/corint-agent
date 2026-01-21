import type { TodoItem as StoredTodoItem } from '@utils/session/todoStorage'
import { buildTodoTree, flattenTodoTree } from './todoTree'

export type TodoRenderModel =
  | {
      kind: 'empty'
      message: string
    }
  | {
      kind: 'list'
      items: Array<{
        checkbox: '☐' | '☒'
        checkboxDim: boolean
        content: string
        contentBold: boolean
        contentDim: boolean
        contentStrikethrough: boolean
        number: string
        depth: number
      }>
    }

export function getTodoRenderModel(todos: StoredTodoItem[]): TodoRenderModel {
  if (todos.length === 0) {
    return { kind: 'empty', message: 'No todos currently tracked' }
  }

  const flattened = flattenTodoTree(buildTodoTree(todos))

  return {
    kind: 'list',
    items: flattened.map(node => {
      const todo = node.todo
      const isCompleted = todo.status === 'completed'
      const isInProgress = todo.status === 'in_progress'

      return {
        checkbox: isCompleted ? '☒' : '☐',
        checkboxDim: isCompleted,
        content: todo.content,
        contentBold: isInProgress,
        contentDim: isCompleted,
        contentStrikethrough: isCompleted,
        number: node.number,
        depth: node.depth,
      }
    }),
  }
}
