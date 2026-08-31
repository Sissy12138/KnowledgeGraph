import { useEffect, useState } from 'react'
import { getAnalysisJob } from './analysis-job.service'
import type { AnalysisJobLoader } from './analysis-job.service'
import type { AnalysisJob, AnalysisStage } from './analysis-job.types'
import './AnalysisProgressPanel.css'

type AnalysisProgressPanelProps = {
  jobId: string
  loadJob?: AnalysisJobLoader
  pollIntervalMs?: number
}

type ViewState =
  | { status: 'loading' }
  | { status: 'success'; job: AnalysisJob }
  | { status: 'error'; message: string }

const stageLabels: Record<AnalysisStage, string> = {
  queued: '等待解析',
  preparing: '准备文档',
  parsing: '解析文档',
  analyzing: '分析知识内容',
  storing: '保存解析结果',
  completed: '解析完成',
  failed: '解析失败',
  cancelled: '解析已取消',
}

const terminalStatuses = new Set(['completed', 'failed', 'cancelled'])

/** 轮询解析任务，并将状态、阶段和进度显示为可访问的进度面板。 */
export default function AnalysisProgressPanel({
  jobId,
  loadJob = getAnalysisJob,
  pollIntervalMs = 1500,
}: AnalysisProgressPanelProps) {
  const [viewState, setViewState] = useState<ViewState>({ status: 'loading' })

  useEffect(() => {
    let isActive = true
    let timerId: ReturnType<typeof setTimeout> | undefined

    const poll = async () => {
      try {
        const job = await loadJob(jobId)
        if (!isActive) return

        setViewState({ status: 'success', job })
        if (!terminalStatuses.has(job.status)) {
          timerId = setTimeout(poll, pollIntervalMs)
        }
      } catch (error: unknown) {
        if (!isActive) return
        const message =
          error instanceof Error ? error.message : '解析进度获取失败。'
        setViewState({ status: 'error', message })
      }
    }

    void poll()

    return () => {
      isActive = false
      if (timerId) clearTimeout(timerId)
    }
  }, [jobId, loadJob, pollIntervalMs])

  if (viewState.status === 'loading') {
    return (
      <span className="analysis-progress-inline analysis-progress-inline--state" role="status">
        正在获取解析进度…
      </span>
    )
  }

  if (viewState.status === 'error') {
    return (
      <span
        className="analysis-progress-inline analysis-progress-inline--error"
        role="alert"
      >
        进度加载失败：{viewState.message}
      </span>
    )
  }

  const { job } = viewState

  return (
    <div
      aria-label="解析进度"
      className={`analysis-progress-inline-wrap analysis-progress-inline-wrap--${job.status}`}
    >
      <div className="analysis-progress-inline">
        <span>{stageLabels[job.stage]}</span>
        <div
          aria-label="论文解析进度"
          aria-valuemax={100}
          aria-valuemin={0}
          aria-valuenow={job.progress}
          className="analysis-progress-inline__track"
          role="progressbar"
        >
          <span style={{ width: `${job.progress}%` }} />
        </div>
        <strong>{job.progress}%</strong>
      </div>
      {job.error && (
        <span className="analysis-progress-inline__error">{job.error.message}</span>
      )}
    </div>
  )
}
