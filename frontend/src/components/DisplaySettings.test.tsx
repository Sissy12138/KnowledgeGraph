import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { DisplayPreferencesProvider } from '../styles/display-preferences'
import DisplaySettings from './DisplaySettings'

function renderSettings() {
  return render(
    <DisplayPreferencesProvider
      initialPreferences={{ themeId: 'softResearch', fontScalePercent: 100 }}
    >
      <DisplaySettings />
    </DisplayPreferencesProvider>,
  )
}

describe('DisplaySettings', () => {
  it('显示规格约定的三套用户可见主题名称', () => {
    renderSettings()

    const themeSelect = screen.getByRole('combobox', { name: '界面主题' })
    expect(
      within(themeSelect).getAllByRole('option').map((option) => option.textContent),
    ).toEqual(['柔和科研', '冷色极简', '暖色纸张'])
  })

  it('切换主题、选择字号并重置', async () => {
    const user = userEvent.setup()
    renderSettings()

    await user.selectOptions(
      screen.getByRole('combobox', { name: '界面主题' }),
      'warmPaper',
    )
    await user.click(screen.getByRole('combobox', { name: '显示字号' }))
    await user.click(screen.getByRole('option', { name: '115%' }))

    expect(
      screen.getByRole('combobox', { name: '显示字号' }),
    ).toHaveTextContent('115%')

    await user.click(
      screen.getByRole('button', { name: '恢复默认显示设置' }),
    )

    expect(screen.getByRole('combobox', { name: '界面主题' })).toHaveValue(
      'softResearch',
    )
    expect(
      screen.getByRole('combobox', { name: '显示字号' }),
    ).toHaveTextContent('100%')
  })

  it('双击或 F2 进入手动输入并校验范围', async () => {
    const user = userEvent.setup()
    renderSettings()
    const combo = screen.getByRole('combobox', { name: '显示字号' })

    await user.dblClick(combo)
    const input = screen.getByRole('spinbutton', { name: '显示字号百分比' })
    await user.clear(input)
    await user.type(input, '117{Enter}')

    expect(
      screen.getByRole('combobox', { name: '显示字号' }),
    ).toHaveTextContent('117%')

    screen.getByRole('combobox', { name: '显示字号' }).focus()
    await user.keyboard('{F2}')
    await user.clear(screen.getByRole('spinbutton'))
    await user.type(screen.getByRole('spinbutton'), '140{Enter}')

    expect(screen.getByRole('alert')).toHaveTextContent(
      '请输入 85–130 之间的整数',
    )
  })

  it('支持 listbox 键盘导航、选择和取消，并暴露活动选项', async () => {
    const user = userEvent.setup()
    renderSettings()
    const combo = screen.getByRole('combobox', { name: '显示字号' })

    combo.focus()
    await user.keyboard('{ArrowDown}')

    expect(combo).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('listbox', { name: '字号选项' })).toBeInTheDocument()
    expect(combo).toHaveAttribute(
      'aria-activedescendant',
      screen.getByRole('option', { name: '105%' }).id,
    )

    await user.keyboard('{End}{Enter}')
    expect(combo).toHaveTextContent('130%')
    expect(combo).toHaveFocus()
    expect(screen.queryByRole('listbox', { name: '字号选项' })).not.toBeInTheDocument()

    await user.keyboard('{Home}')
    expect(combo).toHaveAttribute(
      'aria-activedescendant',
      screen.getByRole('option', { name: '85%' }).id,
    )
    await user.keyboard('{Escape}')
    expect(combo).toHaveTextContent('130%')
    expect(combo).toHaveFocus()
  })

  it('手动输入支持失焦提交和 Escape 取消', async () => {
    const user = userEvent.setup()
    renderSettings()
    const combo = screen.getByRole('combobox', { name: '显示字号' })

    combo.focus()
    await user.keyboard('{F2}')
    const input = screen.getByRole('spinbutton', { name: '显示字号百分比' })
    await user.clear(input)
    await user.type(input, '123')
    await user.tab()
    expect(
      screen.getByRole('combobox', { name: '显示字号' }),
    ).toHaveTextContent('123%')
    expect(
      screen.getByRole('button', { name: '恢复默认显示设置' }),
    ).toHaveFocus()

    screen.getByRole('combobox', { name: '显示字号' }).focus()
    await user.keyboard('{F2}')
    await user.clear(screen.getByRole('spinbutton'))
    await user.type(screen.getByRole('spinbutton'), '90{Escape}')
    expect(
      screen.getByRole('combobox', { name: '显示字号' }),
    ).toHaveTextContent('123%')
    expect(
      screen.getByRole('combobox', { name: '显示字号' }),
    ).toHaveFocus()
  })

  it('鼠标切换主题时提交有效字号且不从主题控件抢回焦点', async () => {
    const user = userEvent.setup()
    renderSettings()
    const combo = screen.getByRole('combobox', { name: '显示字号' })

    combo.focus()
    await user.keyboard('{F2}')
    await user.clear(screen.getByRole('spinbutton'))
    await user.type(screen.getByRole('spinbutton'), '123')

    const themeSelect = screen.getByRole('combobox', { name: '界面主题' })
    await user.selectOptions(themeSelect, 'warmPaper')

    expect(themeSelect).toHaveValue('warmPaper')
    expect(themeSelect).toHaveFocus()
    expect(
      screen.getByRole('combobox', { name: '显示字号' }),
    ).toHaveTextContent('123%')
  })

  it('无效失焦不应用字号，重置可清除编辑态和错误', async () => {
    const user = userEvent.setup()
    renderSettings()
    const combo = screen.getByRole('combobox', { name: '显示字号' })

    combo.focus()
    await user.keyboard('{F2}')
    await user.clear(screen.getByRole('spinbutton'))
    await user.type(screen.getByRole('spinbutton'), '140')
    await user.tab()

    expect(screen.getByRole('alert')).toHaveTextContent(
      '请输入 85–130 之间的整数',
    )
    expect(document.documentElement.style.getPropertyValue('--font-size-root')).toBe('16px')

    const resetButton = screen.getByRole('button', {
      name: '恢复默认显示设置',
    })
    await user.click(resetButton)

    expect(resetButton).toHaveFocus()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()
    expect(
      screen.getByRole('combobox', { name: '显示字号' }),
    ).toHaveTextContent('100%')
  })
})
