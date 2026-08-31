import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { DisplayPreferencesProvider } from '../styles/display-preferences'
import AppShell from './AppShell'

describe('AppShell', () => {
  it('显示品牌、主导航和主内容', () => {
    render(
      <DisplayPreferencesProvider
        initialPreferences={{ themeId: 'softResearch', fontScalePercent: 100 }}
      >
        <MemoryRouter initialEntries={['/papers']}>
          <AppShell>
            <h1>开始构建研知图</h1>
          </AppShell>
        </MemoryRouter>
      </DisplayPreferencesProvider>,
    )

    expect(screen.getByText('研知图')).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: '主导航' })).toBeInTheDocument()
    expect(screen.getByRole('main')).toHaveTextContent('开始构建研知图')
    expect(screen.getByRole('link', { name: '知识图谱' })).toHaveAttribute(
      'href',
      '/graph',
    )
    expect(screen.getByRole('link', { name: '文献库' })).toHaveAttribute(
      'href',
      '/papers',
    )
    expect(screen.getByRole('link', { name: '建议审核' })).toHaveAttribute(
      'href',
      '/review',
    )
    expect(screen.getByRole('link', { name: '文献库' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(screen.getByRole('link', { name: '知识图谱' })).not.toHaveAttribute(
      'aria-current',
    )
    expect(screen.getByText('阶段 1 · 应用外壳')).toBeInTheDocument()
    expect(
      screen.getByRole('combobox', { name: '界面主题' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('combobox', { name: '显示字号' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: '恢复默认显示设置' }),
    ).toBeInTheDocument()
  })

  it('将移动端横向滚动限制在导航子区并让字号浮层留在滚动区外', async () => {
    const user = userEvent.setup()
    const { container } = render(
      <DisplayPreferencesProvider
        initialPreferences={{ themeId: 'softResearch', fontScalePercent: 100 }}
      >
        <MemoryRouter>
          <AppShell><p>正文</p></AppShell>
        </MemoryRouter>
      </DisplayPreferencesProvider>,
    )

    const sidebar = screen.getByRole('navigation', { name: '主导航' })
    const navigationScrollRegion = container.querySelector(
      '.app-sidebar__navigation--mobile-scroll',
    )
    const settings = container.querySelector('.display-settings')

    expect(navigationScrollRegion).toBeInTheDocument()
    expect(navigationScrollRegion?.parentElement).toBe(sidebar)
    expect(settings?.parentElement).toBe(sidebar)

    await user.click(screen.getByRole('combobox', { name: '显示字号' }))
    expect(screen.getByRole('listbox', { name: '字号选项' })).toHaveClass(
      'display-settings__font-listbox',
    )
    expect(navigationScrollRegion).not.toContainElement(
      screen.getByRole('listbox', { name: '字号选项' }),
    )
  })
})
