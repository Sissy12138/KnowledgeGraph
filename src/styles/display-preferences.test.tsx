import { StrictMode } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DisplayPreferencesProvider,
  readStoredDisplayPreferences,
  useDisplayPreferences,
} from './display-preferences'
import { applyAppTheme, applyFontScale } from './app-theme'

function Probe() {
  const value = useDisplayPreferences()

  return <>
    <output aria-label="主题">{value.themeId}</output>
    <output aria-label="字号">{value.fontScalePercent}</output>
    <button onClick={() => value.setThemeId('warmPaper')}>换主题</button>
    <button onClick={() => value.setFontScalePercent(117)}>换字号</button>
    <button onClick={value.resetDisplayPreferences}>重置</button>
  </>
}

function InvalidInputProbe() {
  const value = useDisplayPreferences()

  return <>
    <output aria-label="主题">{value.themeId}</output>
    <output aria-label="字号">{value.fontScalePercent}</output>
    <button onClick={() => value.setFontScalePercent(84)}>过小字号</button>
    <button onClick={() => value.setFontScalePercent(131)}>过大字号</button>
    <button onClick={() => value.setFontScalePercent(100.5)}>小数字号</button>
    <button onClick={() => value.setFontScalePercent(Infinity)}>无限字号</button>
    <button onClick={() => value.setThemeId('not-a-theme' as never)}>非法主题</button>
  </>
}

afterEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
  applyAppTheme('softResearch')
  applyFontScale(100)
})

describe('display preferences', () => {
  it('恢复有效偏好并持久化更新与重置', async () => {
    const user = userEvent.setup()
    localStorage.setItem('yanzhitu.display.theme', 'coolMinimal')
    localStorage.setItem('yanzhitu.display.fontScalePercent', '105')

    render(<DisplayPreferencesProvider><Probe /></DisplayPreferencesProvider>)

    expect(screen.getByLabelText('主题')).toHaveTextContent('coolMinimal')
    expect(screen.getByLabelText('字号')).toHaveTextContent('105')
    expect(document.documentElement.style.getPropertyValue('--color-background')).toBe('#F4F7FA')
    expect(document.documentElement.style.getPropertyValue('--font-size-root')).toBe('16.8px')

    await user.click(screen.getByRole('button', { name: '换主题' }))
    expect(localStorage.getItem('yanzhitu.display.theme')).toBe('warmPaper')
    expect(document.documentElement.style.getPropertyValue('--color-background')).toBe('#F7F3EA')

    await user.click(screen.getByRole('button', { name: '换字号' }))
    expect(localStorage.getItem('yanzhitu.display.fontScalePercent')).toBe('117')
    expect(document.documentElement.style.getPropertyValue('--font-size-root')).toBe('18.72px')

    await user.click(screen.getByRole('button', { name: '重置' }))
    expect(screen.getByLabelText('主题')).toHaveTextContent('softResearch')
    expect(screen.getByLabelText('字号')).toHaveTextContent('100')
    expect(localStorage.getItem('yanzhitu.display.theme')).toBe('softResearch')
    expect(localStorage.getItem('yanzhitu.display.fontScalePercent')).toBe('100')
    expect(document.documentElement.style.getPropertyValue('--color-background')).toBe('#F6F8FC')
    expect(document.documentElement.style.getPropertyValue('--font-size-root')).toBe('16px')
  })

  it('无效或不可访问的存储回退到默认值', () => {
    const broken = { getItem: () => { throw new Error('blocked') } }

    expect(readStoredDisplayPreferences(broken)).toEqual({
      themeId: 'softResearch',
      fontScalePercent: 100,
    })

    localStorage.setItem('yanzhitu.display.theme', 'invalid')
    localStorage.setItem('yanzhitu.display.fontScalePercent', '130.5')
    expect(readStoredDisplayPreferences()).toEqual({
      themeId: 'softResearch',
      fontScalePercent: 100,
    })

    localStorage.clear()
    expect(readStoredDisplayPreferences()).toEqual({
      themeId: 'softResearch',
      fontScalePercent: 100,
    })
  })

  it('归一化运行时初始值，并拒绝非法 setter 输入', async () => {
    const user = userEvent.setup()

    render(
      <DisplayPreferencesProvider initialPreferences={{
        themeId: 'not-a-theme' as never,
        fontScalePercent: 84,
      }}>
        <InvalidInputProbe />
      </DisplayPreferencesProvider>,
    )

    expect(screen.getByLabelText('主题')).toHaveTextContent('softResearch')
    expect(screen.getByLabelText('字号')).toHaveTextContent('100')

    for (const name of ['过小字号', '过大字号', '小数字号', '无限字号', '非法主题']) {
      await user.click(screen.getByRole('button', { name }))
    }

    expect(screen.getByLabelText('主题')).toHaveTextContent('softResearch')
    expect(screen.getByLabelText('字号')).toHaveTextContent('100')
    expect(localStorage.getItem('yanzhitu.display.theme')).toBeNull()
    expect(localStorage.getItem('yanzhitu.display.fontScalePercent')).toBeNull()
    expect(document.documentElement.style.getPropertyValue('--color-background')).toBe('#F6F8FC')
    expect(document.documentElement.style.getPropertyValue('--font-size-root')).toBe('16px')
  })

  it('存储写入失败时仍更新状态与 CSS', async () => {
    const user = userEvent.setup()
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage disabled')
    })

    render(<DisplayPreferencesProvider initialPreferences={{ themeId: 'softResearch', fontScalePercent: 100 }}><Probe /></DisplayPreferencesProvider>)

    await user.click(screen.getByRole('button', { name: '换主题' }))
    await user.click(screen.getByRole('button', { name: '换字号' }))

    expect(screen.getByLabelText('主题')).toHaveTextContent('warmPaper')
    expect(screen.getByLabelText('字号')).toHaveTextContent('117')
    expect(document.documentElement.style.getPropertyValue('--color-background')).toBe('#F7F3EA')
    expect(document.documentElement.style.getPropertyValue('--font-size-root')).toBe('18.72px')
  })

  it('StrictMode 初始挂载不写存储，但会同步 CSS', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem')

    render(
      <StrictMode>
        <DisplayPreferencesProvider initialPreferences={{ themeId: 'warmPaper', fontScalePercent: 112 }}>
          <Probe />
        </DisplayPreferencesProvider>
      </StrictMode>,
    )

    expect(setItem).not.toHaveBeenCalled()
    expect(document.documentElement.style.getPropertyValue('--color-background')).toBe('#F7F3EA')
    expect(document.documentElement.style.getPropertyValue('--font-size-root')).toBe('17.92px')
  })

  it('在 Provider 外调用 hook 时抛出可读错误', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    expect(() => render(<Probe />)).toThrow(/DisplayPreferencesProvider/)
  })
})
