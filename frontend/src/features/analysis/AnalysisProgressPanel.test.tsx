import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AppShell from '../../components/AppShell'
import { DisplayPreferencesProvider } from '../../styles/display-preferences'
import type { AnalysisJob } from './analysis-job.types'
import AnalysisProgressPanel from './AnalysisProgressPanel'

const processingJob: AnalysisJob = {
  id: 'job-test',
  paperId: 'paper-test',
  status: 'processing',
  progress: 58,
  stage: 'analyzing',
  error: null,
  createdAt: '2026-08-29T08:00:00Z',
  startedAt: '2026-08-29T08:00:02Z',
  completedAt: null,
}

afterEach(() => {
  vi.useRealTimers()
})

describe('AnalysisProgressPanel', () => {
  it('主题切换后仍保留分析进度的可访问语义', async () => {
    const user = userEvent.setup()

    render(
      <DisplayPreferencesProvider
        initialPreferences={{ themeId: 'softResearch', fontScalePercent: 100 }}
      >
        <MemoryRouter>
          <AppShell>
            <AnalysisProgressPanel
              jobId="job-test"
              loadJob={async () => processingJob}
            />
          </AppShell>
        </MemoryRouter>
      </DisplayPreferencesProvider>,
    )

    const progressbar = await screen.findByRole('progressbar', {
      name: '论文解析进度',
    })
    expect(document.documentElement.style.getPropertyValue('--color-background')).toBe(
      '#F6F8FC',
    )
    await user.selectOptions(
      screen.getByRole('combobox', { name: '界面主题' }),
      'warmPaper',
    )

    expect(document.documentElement.style.getPropertyValue('--color-background')).toBe(
      '#F7F3EA',
    )
    expect(progressbar).toHaveAttribute('aria-valuenow', '58')
    expect(screen.getByLabelText('解析进度')).toHaveTextContent('分析知识内容')
  })

  it('主题切换后仍保留完成状态的进度条语义', async () => {
    const user = userEvent.setup()
    const completedJob: AnalysisJob = {
      ...processingJob,
      status: 'completed',
      stage: 'completed',
      progress: 100,
      completedAt: '2026-08-29T08:01:00Z',
    }

    render(
      <DisplayPreferencesProvider
        initialPreferences={{ themeId: 'softResearch', fontScalePercent: 100 }}
      >
        <MemoryRouter>
          <AppShell>
            <AnalysisProgressPanel
              jobId="job-test"
              loadJob={async () => completedJob}
            />
          </AppShell>
        </MemoryRouter>
      </DisplayPreferencesProvider>,
    )

    const progressbar = await screen.findByRole('progressbar', {
      name: '论文解析进度',
    })
    await user.selectOptions(
      screen.getByRole('combobox', { name: '界面主题' }),
      'coolMinimal',
    )

    expect(progressbar).toHaveAttribute('aria-valuenow', '100')
    expect(screen.getByLabelText('解析进度')).toHaveTextContent('解析完成')
  })

  it('主题切换后仍保留失败状态的错误文本与进度条语义', async () => {
    const user = userEvent.setup()
    const failedJob: AnalysisJob = {
      ...processingJob,
      status: 'failed',
      stage: 'failed',
      progress: 42,
      error: {
        code: 'AI_SERVICE_TIMEOUT',
        message: 'AI 服务响应超时',
        details: null,
      },
      completedAt: '2026-08-29T08:01:00Z',
    }

    render(
      <DisplayPreferencesProvider
        initialPreferences={{ themeId: 'softResearch', fontScalePercent: 100 }}
      >
        <MemoryRouter>
          <AppShell>
            <AnalysisProgressPanel
              jobId="job-test"
              loadJob={async () => failedJob}
            />
          </AppShell>
        </MemoryRouter>
      </DisplayPreferencesProvider>,
    )

    expect(await screen.findByText('AI 服务响应超时')).toBeInTheDocument()
    expect(document.documentElement.style.getPropertyValue('--color-background')).toBe(
      '#F6F8FC',
    )
    await user.selectOptions(
      screen.getByRole('combobox', { name: '界面主题' }),
      'warmPaper',
    )

    expect(document.documentElement.style.getPropertyValue('--color-background')).toBe(
      '#F7F3EA',
    )
    expect(screen.getByText('AI 服务响应超时')).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '42')
  })

  it('首次请求未完成时显示加载状态', () => {
    render(
      <AnalysisProgressPanel
        jobId="job-test"
        loadJob={() => new Promise<AnalysisJob>(() => undefined)}
      />,
    )

    expect(screen.getByRole('status')).toHaveTextContent('正在获取解析进度')
  })

  it('显示当前解析阶段和进度', async () => {
    render(
      <AnalysisProgressPanel jobId="job-test" loadJob={async () => processingJob} />,
    )

    expect(await screen.findByText('分析知识内容')).toBeInTheDocument()
    expect(screen.getByLabelText('解析进度')).toHaveTextContent('58%')
    expect(
      screen.queryByRole('heading', { name: '解析进度' }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '58')
    expect(screen.getByText('58%')).toBeInTheDocument()
  })

  it('轮询后更新进度，并在完成后停止', async () => {
    vi.useFakeTimers()
    const completedJob: AnalysisJob = {
      ...processingJob,
      status: 'completed',
      stage: 'completed',
      progress: 100,
      completedAt: '2026-08-29T08:01:00Z',
    }
    const responses = [processingJob, completedJob]
    const loadJob = vi.fn(async () => responses.shift() ?? completedJob)

    render(
      <AnalysisProgressPanel
        jobId="job-test"
        loadJob={loadJob}
        pollIntervalMs={1000}
      />,
    )

    await act(async () => undefined)
    expect(screen.getByText('58%')).toBeInTheDocument()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })

    expect(screen.getByText('100%')).toBeInTheDocument()
    expect(screen.getByText('解析完成')).toBeInTheDocument()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000)
    })
    expect(loadJob).toHaveBeenCalledTimes(2)
  })

  it('失败任务显示保留进度和错误原因', async () => {
    const failedJob: AnalysisJob = {
      ...processingJob,
      status: 'failed',
      stage: 'failed',
      progress: 42,
      error: {
        code: 'AI_SERVICE_TIMEOUT',
        message: 'AI 服务响应超时',
        details: null,
      },
      completedAt: '2026-08-29T08:01:00Z',
    }

    render(
      <AnalysisProgressPanel jobId="job-test" loadJob={async () => failedJob} />,
    )

    expect(await screen.findByText('解析失败')).toBeInTheDocument()
    expect(screen.getByText('AI 服务响应超时')).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '42')
  })
})
