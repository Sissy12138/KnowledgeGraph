import { analysisJobTimelines } from './analysis-job.mock'
import type { AnalysisJob } from './analysis-job.types'

export type AnalysisJobLoader = (jobId: string) => Promise<AnalysisJob>

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
