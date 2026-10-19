import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import type { AnalysisJob } from './analysis-job.types'
import AnalysisJobsPage from './AnalysisJobsPage'

function job(overrides: Partial<AnalysisJob>): AnalysisJob {
  return {
    id: 'job-default',
    paperId: 'paper-default',
    paperTitle: '默认论文',
    status: 'completed',
    progress: 100,
    stage: 'completed',
    error: null,
    createdAt: '2026-09-20T00:00:00Z',
    startedAt: '2026-09-20T00:00:01Z',
    completedAt: '2026-09-20T00:01:00Z',
    ...overrides,
  }
}

const jobs: AnalysisJob[] = [
  job({ id: 'done-a', paperId: 'paper-a', paperTitle: '论文 A', status: 'completed' }),
  job({ id: 'failed-a', paperId: 'paper-a', paperTitle: '论文 A', status: 'failed', progress: 42, stage: 'failed' }),
  job({ id: 'cancelled-b', paperId: 'paper-b', paperTitle: '论文 B', status: 'cancelled', progress: 20, stage: 'cancelled' }),
]

function renderPage(overrides: Partial<React.ComponentProps<typeof AnalysisJobsPage>> = {}) {
  const props = {
    loadJobs: vi.fn().mockResolvedValue(jobs),
    cancelTask: vi.fn().mockResolvedValue(undefined),
    rerunTask: vi.fn().mockResolvedValue(undefined),
    deleteTask: vi.fn().mockResolvedValue(undefined),
    refreshIntervalMs: 0,
    ...overrides,
  }
  render(<MemoryRouter><AnalysisJobsPage {...props} /></MemoryRouter>)
  return props
}

describe('AnalysisJobsPage', () => {
  it('为完成任务提供保留和替换两种重新分析模式', async () => {
    renderPage()

    const paperALinks = await screen.findAllByRole('link', { name: '论文 A' })
    const completedRow = paperALinks[0].closest('article')!
    const failedRow = paperALinks[1].closest('article')!

    expect(within(completedRow).getByRole('button', { name: '保留旧结果再分析' })).toHaveClass('analysis-job-action--completed')
    expect(within(completedRow).getByRole('button', { name: '用新结果替换' })).toHaveClass('analysis-job-action--replace')
    expect(within(failedRow).getByRole('button', { name: '重新执行' })).toHaveClass('analysis-job-action--retry')
  })

  it('只有同篇已有完成任务时才允许删除失败或取消记录', async () => {
    renderPage()

    const paperALinks = await screen.findAllByRole('link', { name: '论文 A' })
    const failedRow = paperALinks[1].closest('article')!
    const cancelledRow = screen.getByRole('link', { name: '论文 B' }).closest('article')!

    expect(within(failedRow).getByRole('button', { name: '删除记录' })).toBeInTheDocument()
    expect(within(cancelledRow).queryByRole('button', { name: '删除记录' })).not.toBeInTheDocument()
  })

  it('一键重新执行和删除后刷新任务列表', async () => {
    const user = userEvent.setup()
    const rerunTask = vi.fn().mockResolvedValue(undefined)
    const deleteTask = vi.fn().mockResolvedValue(undefined)
    const props = renderPage({ rerunTask, deleteTask })
    const paperALinks = await screen.findAllByRole('link', { name: '论文 A' })
    const failedRow = paperALinks[1].closest('article')!

    await user.click(within(failedRow).getByRole('button', { name: '重新执行' }))
    await waitFor(() => expect(rerunTask).toHaveBeenCalledWith('paper-a', 'preserve'))
    expect(props.loadJobs).toHaveBeenCalledTimes(2)

    await user.click(within(failedRow).getByRole('button', { name: '删除记录' }))
    await waitFor(() => expect(deleteTask).toHaveBeenCalledWith('failed-a'))
    expect(props.loadJobs).toHaveBeenCalledTimes(3)
  })

  it('一键重新分析只提交尚未完成的失败或取消论文，并按论文去重', async () => {
    const user = userEvent.setup()
    const rerunTask = vi.fn().mockResolvedValue(undefined)
    const props = renderPage({
      rerunTask,
      loadJobs: vi.fn().mockResolvedValue([
        ...jobs,
        job({ id: 'failed-b', paperId: 'paper-b', paperTitle: '论文 B', status: 'failed' }),
        job({ id: 'processing-c', paperId: 'paper-c', paperTitle: '论文 C', status: 'processing', progress: 50, stage: 'analyzing' }),
        job({ id: 'failed-c', paperId: 'paper-c', paperTitle: '论文 C', status: 'failed' }),
      ]),
    })

    const button = await screen.findByRole('button', { name: '一键重新分析失败/取消任务（1）' })
    await user.click(button)

    await waitFor(() => expect(rerunTask).toHaveBeenCalledTimes(1))
    expect(rerunTask).toHaveBeenCalledWith('paper-b')
    expect(rerunTask).not.toHaveBeenCalledWith('paper-a', expect.anything())
    expect(rerunTask).not.toHaveBeenCalledWith('paper-c', expect.anything())
    expect(props.loadJobs).toHaveBeenCalledTimes(2)
  })
})
