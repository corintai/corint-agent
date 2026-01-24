/**
 * Model configuration type definitions
 */

export interface ModelConfig {
  model: string
  max_tokens: number
  max_input_tokens: number
  max_output_tokens: number
  input_cost_per_token: number
  output_cost_per_token: number
  input_cost_per_token_batches?: number
  output_cost_per_token_batches?: number
  cache_read_input_token_cost?: number
  provider: string
  mode: string
  supports_function_calling?: boolean
  supports_parallel_function_calling?: boolean
  supports_response_schema?: boolean
  supports_vision?: boolean
  supports_prompt_caching?: boolean
  supports_system_messages?: boolean
  supports_tool_choice?: boolean
  supports_assistant_prefill?: boolean
  supports_reasoning_effort?: boolean
  supports_responses_api?: boolean
  supports_custom_tools?: boolean
  supports_allowed_tools?: boolean
  supports_verbosity_control?: boolean
  requires_chat_completions?: boolean
}

export interface ProviderConfig {
  name: string
  baseURL: string
}

export type ProviderModels = Record<string, ModelConfig[]>
export type ProviderConfigs = Record<string, ProviderConfig>
