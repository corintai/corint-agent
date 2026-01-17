import type { Message } from './query'

let getMessages: () => Message[] = () => []
type MessagesSetter = (
  value: Message[] | ((prev: Message[]) => Message[]),
) => void

let setMessages: MessagesSetter = () => {}

export function setMessagesGetter(getter: () => Message[]) {
  getMessages = getter
}

export function getMessagesGetter(): () => Message[] {
  return getMessages
}

export function setMessagesSetter(setter: MessagesSetter) {
  setMessages = setter
}

export function getMessagesSetter(): MessagesSetter {
  return setMessages
}

let onModelConfigChange: (() => void) | null = null

export function setModelConfigChangeHandler(handler: () => void) {
  onModelConfigChange = handler
}

export function triggerModelConfigChange() {
  if (onModelConfigChange) {
    onModelConfigChange()
  }
}
