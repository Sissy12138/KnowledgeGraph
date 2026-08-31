import { describe, expect, it } from 'vitest'
import { createMockAnalysisJobLoader } from './analysis-job.service'

describe('createMockAnalysisJobLoader', () => {
  it('处理中的任务进度单调递增并最终完成', async () => {
    const loadJob = createMockAnalysisJobLoader()

    const snapshots = await Promise.all([
      loadJob('job-003'),
      loadJob('job-003'),
      loadJob('job-003'),
      loadJob('job-003'),
      loadJob('job-003'),
    ])

    expect(snapshots.map((job) => job.progress)).toEqual([58, 72, 86, 100, 100])
    expect(snapshots.at(-1)).toMatchObject({
      status: 'completed',
      stage: 'completed',
      progress: 100,
    })
  })

  it('失败任务保留最后进度和错误信息', async () => {
    const loadJob = createMockAnalysisJobLoader()

    await expect(loadJob('job-004')).resolves.toMatchObject({
      status: 'failed',
      stage: 'failed',
      progress: 42,
      error: {
        code: 'AI_SERVICE_TIMEOUT',
        message: 'AI 服务响应超时',
      },
    })
  })

  it('任务 ID 不存在时抛出明确错误', async () => {
    const loadJob = createMockAnalysisJobLoader()

    await expect(loadJob('job-missing')).rejects.toThrow('解析任务不存在。')
  })
})
