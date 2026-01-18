import React from 'react'
import type { ToolUiBridge, ToolPermissionRequest } from '@tool'
import type { SetToolJSXFn } from '@cli/types/toolUi'
import type { ToolUseConfirm } from '@components/permissions/PermissionRequest'
import { BashToolRunInBackgroundOverlay } from '@cli/tools/system/BashTool/BashToolRunInBackgroundOverlay'

type SetToolUseConfirm = React.Dispatch<
  React.SetStateAction<ToolUseConfirm | null>
>

type ToolUiBridgeOptions = {
  setToolJSX: SetToolJSXFn
  setToolUseConfirm?: SetToolUseConfirm
}

export function createToolUiBridge({
  setToolJSX,
  setToolUseConfirm,
}: ToolUiBridgeOptions): ToolUiBridge {
  return {
    showOverlay(overlay) {
      if (!overlay) {
        setToolJSX(null)
        return
      }

      if (overlay.type === 'bash-background') {
        setToolJSX({
          jsx: (
            <BashToolRunInBackgroundOverlay
              onBackground={overlay.onBackground}
            />
          ),
          shouldHidePromptInput: false,
        })
        return
      }

      setToolJSX(null)
    },
    requestToolPermission(request: ToolPermissionRequest) {
      if (!setToolUseConfirm) {
        return Promise.resolve(false)
      }

      return new Promise(resolve => {
        setToolJSX(null)
        setToolUseConfirm({
          assistantMessage: request.assistantMessage,
          tool: request.tool,
          description: request.description,
          input: request.input,
          commandPrefix: request.commandPrefix as any,
          toolUseContext: request.toolUseContext,
          suggestions: request.suggestions as any,
          riskScore: request.riskScore ?? null,
          onAbort() {
            resolve(false)
          },
          onAllow() {
            resolve(true)
          },
          onReject() {
            resolve(false)
          },
        })
      })
    },
  }
}
