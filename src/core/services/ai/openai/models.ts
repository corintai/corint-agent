import { fetch } from 'undici'
import { debug as debugLogger } from '@utils/log/debugLogger'

export async function fetchCustomModels(
  baseURL: string,
  apiKey: string,
): Promise<any[]> {
  try {
    const hasVersionNumber = /\/v\d+/.test(baseURL)
    const cleanBaseURL = baseURL.replace(/\/+$/, '')
    const modelsURL = hasVersionNumber
      ? `${cleanBaseURL}/models`
      : `${cleanBaseURL}/v1/models`

    const response = await fetch(modelsURL, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    })

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error(
          'Invalid API key. Please check your API key and try again.',
        )
      } else if (response.status === 403) {
        throw new Error(
          'API key does not have permission to access models. Please check your API key permissions.',
        )
      } else if (response.status === 404) {
        throw new Error(
          'API endpoint not found. Please check if the base URL is correct and supports the /models endpoint.',
        )
      } else if (response.status === 429) {
        throw new Error(
          'Too many requests. Please wait a moment and try again.',
        )
      } else if (response.status >= 500) {
        throw new Error(
          'API service is temporarily unavailable. Please try again later.',
        )
      } else {
        throw new Error(
          `Unable to connect to API (${response.status}). Please check your base URL, API key, and internet connection.`,
        )
      }
    }

    const data = await response.json()

    const hasDataArray = (obj: unknown): obj is { data: unknown[] } => {
      return (
        typeof obj === 'object' &&
        obj !== null &&
        'data' in obj &&
        Array.isArray((obj as any).data)
      )
    }

    const hasModelsArray = (obj: unknown): obj is { models: unknown[] } => {
      return (
        typeof obj === 'object' &&
        obj !== null &&
        'models' in obj &&
        Array.isArray((obj as any).models)
      )
    }

    let models = []

    if (hasDataArray(data)) {
      models = data.data
    } else if (Array.isArray(data)) {
      models = data
    } else if (hasModelsArray(data)) {
      models = data.models
    } else {
      throw new Error(
        'API returned unexpected response format. Expected an array of models or an object with a \"data\" or \"models\" array.',
      )
    }

    if (!Array.isArray(models)) {
      throw new Error('API response format error: models data is not an array.')
    }

    return models
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes('API key') ||
        error.message.includes('API endpoint') ||
        error.message.includes('API service') ||
        error.message.includes('response format'))
    ) {
      throw error
    }

    debugLogger.warn('CUSTOM_API_MODELS_FETCH_FAILED', {
      baseURL,
      error: error instanceof Error ? error.message : String(error),
    })

    if (error instanceof Error && error.message.includes('fetch')) {
      throw new Error(
        'Unable to connect to the API. Please check the base URL and your internet connection.',
      )
    }

    throw new Error(
      'Failed to fetch models from custom API. Please check your configuration and try again.',
    )
  }
}
