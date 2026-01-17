import type * as React from 'react'

export type ToolJSXState = {
  jsx: React.ReactNode | null
  shouldHidePromptInput: boolean
}

export type SetToolJSXFn = (state: ToolJSXState | null) => void
