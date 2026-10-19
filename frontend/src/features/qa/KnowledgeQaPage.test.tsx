import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import KnowledgeQaPage from './KnowledgeQaPage'

describe('KnowledgeQaPage', () => {
  it('提交问题并显示可回到论文详情的参考材料', async () => {
    const user = userEvent.setup()
    const askQuestion = vi.fn().mockResolvedValue({
      answer: '这些论文主要使用行为任务。[1]', model: 'deepseek-v4-flash',
      sources: [{ id: 'ev-1', type: 'evidence', paperId: 'paper-1', title: '反转学习研究', excerpt: '参与者完成行为任务。', location: 'Methods' }],
    })
    render(<MemoryRouter><KnowledgeQaPage askQuestion={askQuestion} /></MemoryRouter>)

    await user.type(screen.getByLabelText('向文献库提问'), '使用了什么方法？')
    await user.click(screen.getByRole('button', { name: '发送问题' }))

    await waitFor(() => expect(askQuestion).toHaveBeenCalledWith('使用了什么方法？', []))
    expect(await screen.findByText('这些论文主要使用行为任务。[1]')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /反转学习研究/ })).toHaveAttribute('href', '/papers/paper-1')
    expect(screen.getByText(/deepseek-v4-flash/)).toBeInTheDocument()
  })

  it('支持快捷问题和清空对话', async () => {
    const user = userEvent.setup()
    const askQuestion = vi.fn().mockResolvedValue({ answer: '归纳结果。[1]', model: 'test-model', sources: [] })
    render(<MemoryRouter><KnowledgeQaPage askQuestion={askQuestion} /></MemoryRouter>)

    await user.click(screen.getByRole('button', { name: /这些论文主要研究了哪些问题/ }))
    expect(await screen.findByText('归纳结果。[1]')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '清空对话' }))
    expect(screen.getByText('从你的真实文献库开始提问')).toBeInTheDocument()
  })
})
