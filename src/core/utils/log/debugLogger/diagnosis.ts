import chalk from 'chalk'
import { DEBUG_PATHS } from './constants'
import { debug } from './core'
import { isDebugMode } from './flags'
import { terminalLog } from './terminal'
import type { ErrorDiagnosis } from './types'

export function diagnoseError(error: any, context?: any): ErrorDiagnosis {
  const errorMessage = error instanceof Error ? error.message : String(error)
  const errorStack = error instanceof Error ? error.stack : undefined

  if (
    errorMessage.includes('aborted') ||
    errorMessage.includes('AbortController')
  ) {
    return {
      errorType: 'REQUEST_ABORTED',
      category: 'SYSTEM',
      severity: 'MEDIUM',
      description:
        'Request was aborted, often due to user cancellation or timeout',
      suggestions: [
        'Check if ESC key was pressed to cancel the request',
        'Verify network connection stability',
        'Validate AbortController state: isActive and signal.aborted should be consistent',
        'Check for duplicate requests causing conflicts',
      ],
      debugSteps: [
        'Use --debug-verbose mode to view detailed request flow',
        'Check debug logs for BINARY_FEEDBACK_* events',
        'Verify REQUEST_START and REQUEST_END log pairing',
        'Review QUERY_ABORTED event trigger reasons',
      ],
    }
  }

  if (
    errorMessage.includes('api-key') ||
    errorMessage.includes('authentication') ||
    errorMessage.includes('401')
  ) {
    return {
      errorType: 'API_AUTHENTICATION',
      category: 'API',
      severity: 'HIGH',
      description: 'API authentication failed - invalid or missing API key',
      suggestions: [
        'Run /login to reset API key',
        'Check API key in ~/.corint/ configuration files',
        'Verify API key has not expired or been revoked',
        'Confirm the provider setting is correct (anthropic/opendev/bigdream)',
      ],
      debugSteps: [
        'Check CONFIG_LOAD logs for provider and API key status',
        'Run corint doctor to check system health',
        'Review API_ERROR logs for detailed error information',
        'Use corint config command to view current configuration',
      ],
    }
  }

  if (
    errorMessage.includes('ECONNREFUSED') ||
    errorMessage.includes('ENOTFOUND') ||
    errorMessage.includes('timeout')
  ) {
    return {
      errorType: 'NETWORK_CONNECTION',
      category: 'NETWORK',
      severity: 'HIGH',
      description: 'Network connection failed - unable to reach API endpoint',
      suggestions: [
        'Check if network connection is normal',
        'Confirm firewall is not blocking relevant ports',
        'Verify proxy settings are correct',
        'Try switching to a different network environment',
        'Validate baseURL configuration is correct',
      ],
      debugSteps: [
        'Check API_REQUEST_START and related network logs',
        'Review detailed error information in LLM_REQUEST_ERROR',
        'Test API endpoint connectivity with ping or curl',
        'Check if enterprise network requires proxy settings',
      ],
    }
  }

  if (
    errorMessage.includes('permission') ||
    errorMessage.includes('EACCES') ||
    errorMessage.includes('denied')
  ) {
    return {
      errorType: 'PERMISSION_DENIED',
      category: 'PERMISSION',
      severity: 'MEDIUM',
      description: 'Permission denied - insufficient access rights',
      suggestions: [
        'Check file and directory read/write permissions',
        'Confirm current user has sufficient system permissions',
        'Check if administrator privileges are required',
        'Verify tool permission settings are correctly configured',
      ],
      debugSteps: [
        'Review PERMISSION_* logs to understand permission checking process',
        'Check filesystem permissions: ls -la',
        'Verify tool approval status',
        'Review TOOL_* related debug logs',
      ],
    }
  }

  if (
    errorMessage.includes('substring is not a function') ||
    errorMessage.includes('content')
  ) {
    return {
      errorType: 'RESPONSE_FORMAT',
      category: 'API',
      severity: 'MEDIUM',
      description: 'LLM response format mismatch between different providers',
      suggestions: [
        'Check if current provider matches expectations',
        'Verify response format handling logic',
        'Confirm response format differences between providers',
        'Check if response parsing code needs updating',
      ],
      debugSteps: [
        'Review response format in LLM_CALL_DEBUG',
        'Check provider configuration and actual API used',
        'Compare response format differences between Anthropic and OpenAI',
        'Verify logLLMInteraction function format handling',
      ],
    }
  }

  if (
    errorMessage.includes('too long') ||
    errorMessage.includes('context') ||
    errorMessage.includes('token')
  ) {
    return {
      errorType: 'CONTEXT_OVERFLOW',
      category: 'SYSTEM',
      severity: 'MEDIUM',
      description: 'Context window exceeded - conversation too long',
      suggestions: [
        'Run /compact to manually compress conversation history',
        'Check if auto-compression settings are correctly configured',
        'Reduce content length of single inputs',
        'Clean up unnecessary context information',
      ],
      debugSteps: [
        'Review AUTO_COMPACT_* logs to check compression triggers',
        'Check token usage and thresholds',
        'Review CONTEXT_COMPRESSION related logs',
        'Verify model maximum token limits',
      ],
    }
  }

  if (
    errorMessage.includes('config') ||
    (errorMessage.includes('undefined') && context?.configRelated)
  ) {
    return {
      errorType: 'CONFIGURATION',
      category: 'CONFIG',
      severity: 'MEDIUM',
      description: 'Configuration error - missing or invalid settings',
      suggestions: [
        'Run corint config to check configuration settings',
        'Delete corrupted configuration files and reinitialize',
        'Check if JSON configuration file syntax is correct',
        'Verify environment variable settings',
      ],
      debugSteps: [
        'Review CONFIG_LOAD and CONFIG_SAVE logs',
        'Check configuration file paths and permissions',
        'Verify JSON format: cat ~/.corint/config.json | jq',
        'Review debug information related to configuration caching',
      ],
    }
  }

  return {
    errorType: 'UNKNOWN',
    category: 'SYSTEM',
    severity: 'MEDIUM',
    description: `Unexpected error: ${errorMessage}`,
    suggestions: [
      'Restart the application',
      'Check if system resources are sufficient',
      'Review complete error logs for more information',
      'If the problem persists, please report this error',
    ],
    debugSteps: [
      'Use --debug-verbose to get detailed logs',
      'Check complete error information in error.log',
      'Review system resource usage',
      'Collect reproduction steps and environment information',
    ],
    relatedLogs: errorStack ? [errorStack] : undefined,
  }
}

export function logErrorWithDiagnosis(
  error: any,
  context?: any,
  requestId?: string,
) {
  if (!isDebugMode()) return

  const diagnosis = diagnoseError(error, context)
  const errorMessage = error instanceof Error ? error.message : String(error)

  debug.error(
    'ERROR_OCCURRED',
    {
      error: errorMessage,
      errorType: diagnosis.errorType,
      category: diagnosis.category,
      severity: diagnosis.severity,
      context,
    },
    requestId,
  )

  terminalLog('\n' + chalk.red('🚨 ERROR DIAGNOSIS'))
  terminalLog(chalk.gray('━'.repeat(60)))

  terminalLog(chalk.red(`❌ ${diagnosis.errorType}`))
  terminalLog(
    chalk.dim(
      `Category: ${diagnosis.category} | Severity: ${diagnosis.severity}`,
    ),
  )
  terminalLog(`\n${diagnosis.description}`)

  terminalLog(chalk.yellow('\n💡 Recovery Suggestions:'))
  diagnosis.suggestions.forEach((suggestion, index) => {
    terminalLog(`   ${index + 1}. ${suggestion}`)
  })

  terminalLog(chalk.cyan('\n🔍 Debug Steps:'))
  diagnosis.debugSteps.forEach((step, index) => {
    terminalLog(`   ${index + 1}. ${step}`)
  })

  if (diagnosis.relatedLogs && diagnosis.relatedLogs.length > 0) {
    terminalLog(chalk.magenta('\n📋 Related Information:'))
    diagnosis.relatedLogs.forEach((log, index) => {
      const truncatedLog =
        log.length > 200 ? log.substring(0, 200) + '...' : log
      terminalLog(chalk.dim(`   ${truncatedLog}`))
    })
  }

  const debugPath = DEBUG_PATHS.base()
  terminalLog(chalk.gray(`\n📁 Complete logs: ${debugPath}`))
  terminalLog(chalk.gray('━'.repeat(60)))
}
