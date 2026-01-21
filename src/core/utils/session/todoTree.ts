import type { TodoItem } from '@utils/session/todoStorage'

export type TodoTreeNode = {
  todo: TodoItem
  children: TodoTreeNode[]
  number: string
  depth: number
}

type TodoNode = {
  todo: TodoItem
  children: TodoNode[]
}

function buildIndexMap(todos: TodoItem[]): Map<string, number> {
  const indexMap = new Map<string, number>()
  todos.forEach((todo, index) => {
    indexMap.set(todo.id, index)
  })
  return indexMap
}

function compareTodos(
  a: TodoItem,
  b: TodoItem,
  indexMap: Map<string, number>,
): number {
  const orderA = Number.isFinite(a.order) ? (a.order as number) : null
  const orderB = Number.isFinite(b.order) ? (b.order as number) : null

  if (orderA !== null && orderB !== null && orderA !== orderB) {
    return orderA - orderB
  }
  if (orderA !== null && orderB === null) return -1
  if (orderA === null && orderB !== null) return 1

  const indexA = indexMap.get(a.id) ?? 0
  const indexB = indexMap.get(b.id) ?? 0
  if (indexA !== indexB) return indexA - indexB

  return a.content.localeCompare(b.content)
}

export function buildTodoTree(todos: TodoItem[]): TodoNode[] {
  const nodes = new Map<string, TodoNode>()
  const indexMap = buildIndexMap(todos)
  for (const todo of todos) {
    nodes.set(todo.id, { todo, children: [] })
  }

  const roots: TodoNode[] = []
  for (const todo of todos) {
    const node = nodes.get(todo.id)!
    const parentId = todo.parentId
    if (!parentId || parentId === todo.id || !nodes.has(parentId)) {
      roots.push(node)
      continue
    }
    nodes.get(parentId)!.children.push(node)
  }

  const sortNode = (node: TodoNode) => {
    node.children.sort((a, b) =>
      compareTodos(a.todo, b.todo, indexMap),
    )
    node.children.forEach(sortNode)
  }

  roots.sort((a, b) => compareTodos(a.todo, b.todo, indexMap))
  roots.forEach(sortNode)

  return roots
}

export function flattenTodoTree(nodes: TodoNode[]): TodoTreeNode[] {
  const flattened: TodoTreeNode[] = []

  const visit = (node: TodoNode, prefix: string, depth: number) => {
    const number = prefix
    flattened.push({ todo: node.todo, children: [], number, depth })
    node.children.forEach((child, index) => {
      const childNumber = `${number}.${index + 1}`
      visit(child, childNumber, depth + 1)
    })
  }

  nodes.forEach((node, index) => {
    const number = `${index + 1}`
    visit(node, number, 0)
  })

  return flattened
}

export function buildTodoNumberMaps(todos: TodoItem[]): {
  idToNumber: Map<string, string>
  numberToId: Map<string, string>
} {
  const roots = buildTodoTree(todos)
  const flattened = flattenTodoTree(roots)
  const idToNumber = new Map<string, string>()
  const numberToId = new Map<string, string>()
  for (const node of flattened) {
    idToNumber.set(node.todo.id, node.number)
    numberToId.set(node.number, node.todo.id)
  }
  return { idToNumber, numberToId }
}
