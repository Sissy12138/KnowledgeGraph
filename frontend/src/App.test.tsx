import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { DisplayPreferencesProvider } from './styles/display-preferences'
import App from './App'

vi.mock('./features/graph/GraphCanvas', () => ({
  default: () => <div aria-label="测试图谱画布" />,
}))

function renderApp(initialEntry: string) {
  return render(
    <DisplayPreferencesProvider
      initialPreferences={{ themeId: 'softResearch', fontScalePercent: 100 }}
    >
      <MemoryRouter initialEntries={[initialEntry]}>
        <App />
      </MemoryRouter>
    </DisplayPreferencesProvider>,
  )
}

describe('App', () => {
  it('在应用外壳中显示论文列表', async () => {
    renderApp('/papers')

    expect(
      screen.getByRole('heading', { name: '论文库' }),
    ).toBeInTheDocument()
    expect(
      await screen.findByRole('heading', {
        name: '反转学习中的认知灵活性与前额叶活动',
      }),
    ).toBeInTheDocument()
  })

  it('详情地址显示对应论文并能返回列表', async () => {
    const user = userEvent.setup()

    renderApp('/papers/paper-001')

    expect(
      await screen.findByRole('heading', {
        name: '反转学习中的认知灵活性与前额叶活动',
        level: 1,
      }),
    ).toBeInTheDocument()
    expect(screen.getByText('反馈相关神经信号能否预测规则变化后的行为调整？')).toBeInTheDocument()

    await user.click(screen.getByRole('link', { name: /返回论文库/ }))

    expect(await screen.findByRole('heading', { name: '论文库' })).toBeInTheDocument()
  })

  it('审核地址显示建议审核工作台', async () => {
    renderApp('/review')

    expect(
      screen.getByRole('heading', { name: '建议审核' }),
    ).toBeInTheDocument()
    expect(
      await screen.findByRole('tab', { name: '待审核 4' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '建议审核' })).toHaveAttribute(
      'aria-current',
      'page',
    )
  })

  it('图谱地址显示知识图谱页面', async () => {
    renderApp('/graph')

    expect(screen.getByRole('heading', { name: '知识图谱' })).toBeInTheDocument()
    expect(await screen.findByText('概念网络')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '知识图谱' })).toHaveAttribute(
      'aria-current',
      'page',
    )
  })

  it('从图谱关联论文链接能打开成功的论文详情', async () => {
    const user = userEvent.setup()
    renderApp('/graph')

    const paperLink = await screen.findByRole('link', {
      name: '查看论文：反转学习中的认知灵活性与前额叶活动',
    })
    await user.click(paperLink)

    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: '反转学习中的认知灵活性与前额叶活动',
      }),
    ).toBeInTheDocument()
    expect(screen.queryByText('论文不存在。')).not.toBeInTheDocument()
  })

  it('切换主题后应用外壳使用新的根变量', async () => {
    const user = userEvent.setup()

    renderApp('/papers')

    await user.selectOptions(
      screen.getByRole('combobox', { name: '界面主题' }),
      'warmPaper',
    )

    expect(document.documentElement.style.getPropertyValue('--color-background')).toBe('#F7F3EA')
    expect(document.documentElement.style.getPropertyValue('--color-sidebar')).toBe('#332F2A')
  })
})
