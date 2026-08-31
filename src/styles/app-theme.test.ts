import { describe, expect, it } from 'vitest'
import {
  APP_THEMES,
  DEFAULT_THEME_ID,
  applyAppTheme,
  applyFontScale,
  getAppTheme,
} from './app-theme'

describe('app theme', () => {
  it('提供三个完整主题并默认使用柔和科研', () => {
    expect(Object.keys(APP_THEMES)).toEqual(['softResearch', 'coolMinimal', 'warmPaper'])
    expect(DEFAULT_THEME_ID).toBe('softResearch')
    for (const theme of Object.values(APP_THEMES)) {
      expect(Object.keys(theme.graph.nodes)).toEqual(['paper', 'author', 'concept', 'method', 'finding'])
      expect(theme.semantic.danger).toEqual(expect.objectContaining({
        foreground: expect.stringMatching(/^#/),
        background: expect.stringMatching(/^#/),
        border: expect.stringMatching(/^#/),
      }))
    }
  })

  it('把主题和字号映射到根元素变量并更新活动主题', () => {
    applyAppTheme('warmPaper')
    applyFontScale(117)
    expect(document.documentElement.style.getPropertyValue('--color-background')).toBe('#F7F3EA')
    expect(document.documentElement.style.getPropertyValue('--graph-node-concept')).toBe('#C6DDD3')
    expect(document.documentElement.style.getPropertyValue('--font-size-root')).toBe('18.72px')
    expect(getAppTheme()).toBe(APP_THEMES.warmPaper)
  })
})
