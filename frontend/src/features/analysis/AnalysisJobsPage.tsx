import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { AnalysisJob } from './analysis-job.types'
import {
  cancelAnalysisJob,
  deleteAnalysisJob,
  listAnalysisJobs,
  rerunAnalysisJob,
} from './analysis-job.service'
import type { AnalysisResultMode } from './analysis-job.service'
import './AnalysisJobsPage.css'

const labels: Record<AnalysisJob['status'], string> = {
  queued: '排队中',
  processing: '处理中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
}

type AnalysisJobsPageProps = {
  loadJobs?: () => Promise<AnalysisJob[]>
  cancelTask?: (jobId: string) => Promise<void>
  rerunTask?: (paperId: string, resultMode?: AnalysisResultMode) => Promise<void>
  deleteTask?: (jobId: string) => Promise<void>
  refreshIntervalMs?: number
}

export default function AnalysisJobsPage({
  loadJobs = listAnalysisJobs,
  cancelTask = cancelAnalysisJob,
  rerunTask = rerunAnalysisJob,
  deleteTask = deleteAnalysisJob,
  refreshIntervalMs = 3000,
}: AnalysisJobsPageProps) {
  const [jobs, setJobs] = useState<AnalysisJob[]>([])
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [pendingActionId, setPendingActionId] = useState<string | null>(null)
  const [isRerunningFailed, setIsRerunningFailed] = useState(false)

  const load = useCallback(async () => {
    try {
      setJobs(await loadJobs())
      setError('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '任务加载失败。')
    }
  }, [loadJobs])

  useEffect(() => {
    void load()
    if (refreshIntervalMs <= 0) return
    const id = window.setInterval(() => void load(), refreshIntervalMs)
    return () => window.clearInterval(id)
  }, [load, refreshIntervalMs])

  const completedPaperIds = useMemo(
    () => new Set(jobs.filter((job) => job.status === 'completed').map((job) => job.paperId)),
    [jobs],
  )
  const activePaperIds = useMemo(
    () => new Set(jobs.filter((job) => job.status === 'queued' || job.status === 'processing').map((job) => job.paperId)),
    [jobs],
  )
  const failedOrCancelledPaperIds = useMemo(
    () => [...new Set(
      jobs
        .filter((job) => job.status === 'failed' || job.status === 'cancelled')
        .map((job) => job.paperId),
    )].filter((paperId) => !completedPaperIds.has(paperId) && !activePaperIds.has(paperId)),
    [activePaperIds, completedPaperIds, jobs],
  )

  async function runAction(jobId: string, action: () => Promise<void>, successMessage: string) {
    setPendingActionId(jobId)
    setMessage('')
    setError('')
    try {
      await action()
      setMessage(successMessage)
      await load()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '操作失败，请稍后重试。')
    } finally {
      setPendingActionId(null)
    }
  }

  async function rerunFailedOrCancelled() {
    if (failedOrCancelledPaperIds.length === 0) return

    setIsRerunningFailed(true)
    setMessage('')
    setError('')
    try {
      const results = await Promise.allSettled(
        failedOrCancelledPaperIds.map((paperId) => rerunTask(paperId)),
      )
      const succeeded = results.filter((result) => result.status === 'fulfilled').length
      const failed = results.length - succeeded

      if (succeeded > 0) {
        setMessage(`已为 ${succeeded} 篇失败或取消的论文创建新分析任务。`)
      }
      if (failed > 0) {
        setError(`${failed} 篇论文未能重新提交，请稍后再试。`)
      }
      await load()
    } finally {
      setIsRerunningFailed(false)
    }
  }

  return (
    <section className="analysis-jobs-page">
      <header className="analysis-jobs-page__header">
        <div>
          <p>ANALYSIS QUEUE</p>
          <h1>分析任务</h1>
          <span>任务状态每 3 秒自动刷新</span>
        </div>
        <button
          className="analysis-jobs-page__rerun-all"
          disabled={isRerunningFailed || failedOrCancelledPaperIds.length === 0}
          onClick={() => void rerunFailedOrCancelled()}
          title="按论文去重；跳过已有完成结果或正在运行的论文"
          type="button"
        >
          <span aria-hidden="true">↻</span>
          {isRerunningFailed
            ? '正在重新提交…'
            : `一键重新分析失败/取消任务（${failedOrCancelledPaperIds.length}）`}
        </button>
      </header>
      {error && <p className="analysis-jobs-page__error" role="alert">{error}</p>}
      {message && <p className="analysis-jobs-page__message" role="status">{message}</p>}
      {jobs.length === 0 ? (
        <p>暂无分析任务。</p>
      ) : (
        <div className="analysis-jobs-table">
          {jobs.map((job) => {
            const isActive = job.status === 'queued' || job.status === 'processing'
            const isRetryable = job.status === 'failed' || job.status === 'cancelled'
            const hasActiveRun = activePaperIds.has(job.paperId)
            const canDelete = isRetryable && completedPaperIds.has(job.paperId)
            const isPending = pendingActionId === job.id

            return (
              <article data-status={job.status} key={job.id}>
                <div className="analysis-job-summary">
                  <Link to={`/papers/${job.paperId}`}>{job.paperTitle || `论文 ${job.paperId.slice(0, 8)}…`}</Link>
                  <strong>{labels[job.status]}</strong>
                </div>
                <span>{job.stage} · {job.progress}%</span>
                <div className="analysis-job-actions">
                  {isActive && (
                    <button
                      className="analysis-job-action analysis-job-action--cancel"
                      disabled={isPending || isRerunningFailed}
                      onClick={() => void runAction(job.id, () => cancelTask(job.id), '任务已取消。')}
                      type="button"
                    >
                      取消
                    </button>
                  )}
                  {isRetryable && (
                    <button
                      className="analysis-job-action analysis-job-action--retry"
                      disabled={isPending || hasActiveRun || isRerunningFailed}
                      onClick={() => void runAction(job.id, () => rerunTask(job.paperId, 'preserve'), '已创建新的分析任务。')}
                      title={hasActiveRun ? '同一篇论文已有任务正在运行' : undefined}
                      type="button"
                    >
                      重新执行
                    </button>
                  )}
                  {job.status === 'completed' && (
                    <>
                      <button
                        className="analysis-job-action analysis-job-action--completed"
                        disabled={isPending || hasActiveRun || isRerunningFailed}
                        onClick={() => void runAction(job.id, () => rerunTask(job.paperId, 'preserve'), '已创建新任务；旧分析结果将保留。')}
                        title={hasActiveRun ? '同一篇论文已有任务正在运行' : '新结果与旧结果并存，旧图谱节点和审核记录不删除'}
                        type="button"
                      >
                        保留旧结果再分析
                      </button>
                      <button
                        className="analysis-job-action analysis-job-action--replace"
                        disabled={isPending || hasActiveRun || isRerunningFailed}
                        onClick={() => void runAction(job.id, () => rerunTask(job.paperId, 'replace'), '已创建替换分析任务；只有新分析成功后才会删除旧结果。')}
                        title={hasActiveRun ? '同一篇论文已有任务正在运行' : '新分析成功后，删除该论文的旧节点、关系和审核结果；失败时保留旧结果'}
                        type="button"
                      >
                        用新结果替换
                      </button>
                    </>
                  )}
                  {canDelete && (
                    <button
                      className="analysis-job-action analysis-job-action--delete"
                      disabled={isPending || isRerunningFailed}
                      onClick={() => void runAction(job.id, () => deleteTask(job.id), '任务记录已删除。')}
                      type="button"
                    >
                      删除记录
                    </button>
                  )}
                </div>
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}
