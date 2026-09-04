import type { AnalysisJob } from './analysis-job.types'

const job003Base = {
  id: 'job-003',
  paperId: 'paper-003',
  error: null,
  createdAt: '2026-08-26T09:55:00Z',
  startedAt: '2026-08-26T09:55:04Z',
}

/** 同一任务在多次轮询中的响应快照，进度只能保持或增加。 */
export const analysisJobTimelines: Record<string, AnalysisJob[]> = {
  'job-001': [
    {
      id: 'job-001',
      paperId: 'paper-001',
      status: 'completed',
      progress: 100,
      stage: 'completed',
      error: null,
      createdAt: '2026-08-26T08:00:00Z',
      startedAt: '2026-08-26T08:00:05Z',
      completedAt: '2026-08-26T08:06:00Z',
    },
  ],
  'job-002': [
    {
      id: 'job-002',
      paperId: 'paper-002',
      status: 'completed',
      progress: 100,
      stage: 'completed',
      error: null,
      createdAt: '2026-08-25T11:00:00Z',
      startedAt: '2026-08-25T11:00:03Z',
      completedAt: '2026-08-25T11:05:00Z',
    },
  ],
  'job-003': [
    {
      ...job003Base,
      status: 'processing',
      progress: 58,
      stage: 'analyzing',
      completedAt: null,
    },
    {
      ...job003Base,
      status: 'processing',
      progress: 72,
      stage: 'analyzing',
      completedAt: null,
    },
    {
      ...job003Base,
      status: 'processing',
      progress: 86,
      stage: 'storing',
      completedAt: null,
    },
    {
      ...job003Base,
      status: 'completed',
      progress: 100,
      stage: 'completed',
      completedAt: '2026-08-26T10:08:00Z',
    },
  ],
  'job-004': [
    {
      id: 'job-004',
      paperId: 'paper-004',
      status: 'failed',
      progress: 42,
      stage: 'failed',
      error: {
        code: 'AI_SERVICE_TIMEOUT',
        message: 'AI 服务响应超时',
        details: null,
      },
      createdAt: '2026-08-26T09:58:00Z',
      startedAt: '2026-08-26T09:58:04Z',
      completedAt: '2026-08-26T10:05:00Z',
    },
  ],
  'job-005': [
    {
      id: 'job-005',
      paperId: 'paper-003',
      status: 'cancelled',
      progress: 35,
      stage: 'cancelled',
      error: null,
      createdAt: '2026-08-25T09:00:00Z',
      startedAt: '2026-08-25T09:00:03Z',
      completedAt: '2026-08-25T09:02:00Z',
    },
  ],
}
