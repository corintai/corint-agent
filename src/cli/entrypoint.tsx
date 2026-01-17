#!/usr/bin/env bun
import '@utils/config/sanitizeAnthropicEnv'
import {
  ensurePackagedRuntimeEnv,
  ensureYogaWasmPath,
} from './utils/bootstrapEnv'
import { installProcessHandlers, runCli } from './utils/runCli'

ensurePackagedRuntimeEnv()
ensureYogaWasmPath(import.meta.url)

import * as dontcare from '@anthropic-ai/sdk/shims/node'
Object.keys(dontcare)

installProcessHandlers()
void runCli()
