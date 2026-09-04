import { APP_THEMES, DEFAULT_THEME_ID, type AppThemeId } from '../app-theme'

const DEFAULT_FONT_SCALE_PERCENT = 100
const MIN_FONT_SCALE_PERCENT = 85
const MAX_FONT_SCALE_PERCENT = 130

export const DISPLAY_PREFERENCE_KEYS = {
  theme: 'yanzhitu.display.theme',
  fontScale: 'yanzhitu.display.fontScalePercent',
} as const

export type StoredDisplayPreferences = {
  themeId: AppThemeId
  fontScalePercent: number
}

export function isAppThemeId(value: string | null): value is AppThemeId {
  return value !== null && Object.hasOwn(APP_THEMES, value)
}

export function isFontScalePercent(value: number): boolean {
  return Number.isInteger(value)
    && value >= MIN_FONT_SCALE_PERCENT
    && value <= MAX_FONT_SCALE_PERCENT
}

export function defaultDisplayPreferences(): StoredDisplayPreferences {
  return {
    themeId: DEFAULT_THEME_ID,
    fontScalePercent: DEFAULT_FONT_SCALE_PERCENT,
  }
}

export function normalizeDisplayPreferences(
  preferences: StoredDisplayPreferences,
): StoredDisplayPreferences {
  return {
    themeId: isAppThemeId(preferences.themeId) ? preferences.themeId : DEFAULT_THEME_ID,
    fontScalePercent: isFontScalePercent(preferences.fontScalePercent)
      ? preferences.fontScalePercent
      : DEFAULT_FONT_SCALE_PERCENT,
  }
}

/** 从浏览器存储恢复显示偏好；不可用或无效值统一回退至默认设置。 */
export function readStoredDisplayPreferences(
  storage?: Pick<Storage, 'getItem'>,
): StoredDisplayPreferences {
  try {
    const source = storage ?? localStorage
    const themeId = source.getItem(DISPLAY_PREFERENCE_KEYS.theme)
    const fontScalePercent = Number(source.getItem(DISPLAY_PREFERENCE_KEYS.fontScale))

    return {
      themeId: isAppThemeId(themeId) ? themeId : DEFAULT_THEME_ID,
      fontScalePercent: isFontScalePercent(fontScalePercent)
        ? fontScalePercent
        : DEFAULT_FONT_SCALE_PERCENT,
    }
  } catch {
    return defaultDisplayPreferences()
  }
}

export function persistPreference(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // 浏览器禁用存储时，仍保留本次会话中的显示设置。
  }
}
