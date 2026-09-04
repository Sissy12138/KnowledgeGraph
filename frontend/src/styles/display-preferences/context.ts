import { createContext, useContext } from 'react'
import type { AppThemeId } from '../app-theme'

export type DisplayPreferencesContextValue = {
  themeId: AppThemeId
  fontScalePercent: number
  setThemeId: (themeId: AppThemeId) => void
  setFontScalePercent: (fontScalePercent: number) => void
  resetDisplayPreferences: () => void
}

export const displayPreferencesContext = createContext<DisplayPreferencesContextValue | null>(null)

/** 读取当前显示偏好；仅可在 DisplayPreferencesProvider 内使用。 */
export function useDisplayPreferences(): DisplayPreferencesContextValue {
  const value = useContext(displayPreferencesContext)
  if (value === null) {
    throw new Error('useDisplayPreferences 必须在 DisplayPreferencesProvider 内使用。')
  }
  return value
}
