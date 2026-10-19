import { analysisJobTimelines } from './analysis-job.mock'
import { requestJson } from '../../contracts/api-client'
import { getDataMode } from '../../contracts/data-mode'
import type { AnalysisJob } from './analysis-job.types'

export type AnalysisJobLoader = (jobId: string) => Promise<AnalysisJob>
export type AnalysisJobPage = { items: AnalysisJob[] }
export type AnalysisResultMode = 'preserve' | 'replace'

/**
 * 创建带独立轮询位置的 Mock 加载器。
 * 每调用一次，同一处理任务就返回下一份进度快照；终态保持不变。
 */
export function createMockAnalysisJobLoader(): AnalysisJobLoader {
  const nextSnapshotByJob = new Map<string, number>()

  return async (jobId: string) => {
    const timeline = analysisJobTimelines[jobId]

    if (!timeline) {
      throw new Error('解析任务不存在。')
    }

    const nextIndex = nextSnapshotByJob.get(jobId) ?? 0
    const currentIndex = Math.min(nextIndex, timeline.length - 1)
    nextSnapshotByJob.set(jobId, currentIndex + 1)

    return structuredClone(timeline[currentIndex])
  }
}

export const getAnalysisJob = createMockAnalysisJobLoader()

export const loadAnalysisJob: AnalysisJobLoader = async (jobId) => {
  if (getDataMode() === 'api') {
    return requestJson<AnalysisJob>(`/api/v1/analysis-jobs/${encodeURIComponent(jobId)}`)
  }
  return getAnalysisJob(jobId)
}

export async function listAnalysisJobs(): Promise<AnalysisJob[]> {
  if (getDataMode() !== 'api') return []
  return (await requestJson<AnalysisJobPage>('/api/v1/analysis-jobs?limit=100')).items
}

export async function cancelAnalysisJob(jobId: string): Promise<void> {
  await requestJson(`/api/v1/analysis-jobs/${encodeURIComponent(jobId)}/cancel`, {
    method: 'POST',
    body: '{}',
  })
}

export async function rerunAnalysisJob(
  paperId: string,
  resultMode: AnalysisResultMode = 'preserve',
): Promise<void> {
  await requestJson(`/api/v1/papers/${encodeURIComponent(paperId)}/analysis-jobs`, {
    method: 'POST',
    body: JSON.stringify({ resultMode }),
  })
}

export async function deleteAnalysisJob(jobId: string): Promise<void> {
  await requestJson(`/api/v1/analysis-jobs/${encodeURIComponent(jobId)}`, {
    method: 'DELETE',
  })
}
