import {
  pluginHooksCache,
  sessionStartCache,
  settingsHooksCache,
} from './state'

export function __resetKodeHooksCacheForTests(): void {
  settingsHooksCache.clear()
  pluginHooksCache.clear()
  sessionStartCache.clear()
}
