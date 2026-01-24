/**
 * Model configurations - re-exports from the original models.ts for backwards compatibility
 *
 * This module provides a cleaner organization of model configurations.
 * The original models.ts file is preserved for backwards compatibility.
 *
 * Usage:
 *   import models, { providers } from '@constants/models'
 *   // or
 *   import { providers } from '@constants/models/providers'
 *   import type { ModelConfig, ProviderConfig } from '@constants/models/types'
 */

// Re-export types
export type { ModelConfig, ProviderConfig, ProviderModels, ProviderConfigs } from './types'

// Re-export providers
export { providers } from './providers'

// Re-export default models from original file for backwards compatibility
import models from '../models'
export default models
