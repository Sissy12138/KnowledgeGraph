import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react'
import { applyAppTheme, applyFontScale, DEFAULT_THEME_ID, type AppThemeId } from '../app-theme'
import {
  DISPLAY_PREFERENCE_KEYS,
  isAppThemeId,
  isFontScalePercent,
  normalizeDisplayPreferences,
  persistPreference,
  readStoredDisplayPreferences,
  type StoredDisplayPreferences,
} from './storage'
import {
  displayPreferencesContext,
  type DisplayPreferencesContextValue,
} from './context'

const DEFAULT_FONT_SCALE_PERCENT = 100

type DisplayPreferencesProviderProps = PropsWithChildren<{
  initialPreferences?: StoredDisplayPreferences
}>

/** 提供全局主题、字号状态，并保持根元素样式与本地存储同步。 */
export function DisplayPreferencesProvider({
  children,
  initialPreferences,
}: DisplayPreferencesProviderProps) {
  const [preferences, setPreferences] = useState<StoredDisplayPreferences>(() => (
    initialPreferences
      ? normalizeDisplayPreferences(initialPreferences)
      : readStoredDisplayPreferences()
  ))

  useEffect(() => {
    applyAppTheme(preferences.themeId)
    applyFontScale(preferences.fontScalePercent)
  }, [preferences.fontScalePercent, preferences.themeId])

  const setThemeId = useCallback((themeId: AppThemeId) => {
    if (!isAppThemeId(themeId)) {
      return
    }

    applyAppTheme(themeId)
    setPreferences((current) => ({ ...current, themeId }))
    persistPreference(DISPLAY_PREFERENCE_KEYS.theme, themeId)
  }, [])

  const setFontScalePercent = useCallback((fontScalePercent: number) => {
    if (!isFontScalePercent(fontScalePercent)) {
      return
    }

    applyFontScale(fontScalePercent)
    setPreferences((current) => ({ ...current, fontScalePercent }))
    persistPreference(DISPLAY_PREFERENCE_KEYS.fontScale, String(fontScalePercent))
  }, [])

  const resetDisplayPreferences = useCallback(() => {
    setThemeId(DEFAULT_THEME_ID)
    setFontScalePercent(DEFAULT_FONT_SCALE_PERCENT)
  }, [setFontScalePercent, setThemeId])

  const value = useMemo<DisplayPreferencesContextValue>(() => ({
    ...preferences,
    setThemeId,
    setFontScalePercent,
    resetDisplayPreferences,
  }), [preferences, resetDisplayPreferences, setFontScalePercent, setThemeId])

  return (
    <displayPreferencesContext.Provider value={value}>
      {children}
    </displayPreferencesContext.Provider>
  )
}
