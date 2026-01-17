export type ModelInfo = {
  model: string
  provider: string
  [key: string]: any
}

export type ModelSelectorScreen =
  | 'provider'
  | 'partnerProviders'
  | 'partnerCodingPlans'
  | 'apiKey'
  | 'resourceName'
  | 'baseUrl'
  | 'model'
  | 'modelInput'
  | 'modelParams'
  | 'contextLength'
  | 'connectionTest'
  | 'confirmation'

export type ConnectionTestResult = {
  success: boolean
  message: string
  endpoint?: string
  details?: string
}
