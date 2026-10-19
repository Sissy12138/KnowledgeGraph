import { describe, expect, it, vi } from 'vitest'
import {
  createMockAnalysisJobLoader,
  deleteAnalysisJob,
  listAnalysisJobs,
  loadAnalysisJob,
  rerunAnalysisJob,
} from './analysis-job.service'

describe('createMockAnalysisJobLoader', () => {
  it('API 模式从 A 获取任务状态', async () => {
    vi.stubEnv('VITE_DATA_MODE', 'api')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: 'job-api', paperId: 'paper-api', status: 'processing', progress: 42, stage: 'analyzing', error: null,
      createdAt: '', startedAt: '', completedAt: null,
    }), { status: 200 })))
    await expect(loadAnalysisJob('job-api')).resolves.toMatchObject({ id: 'job-api', progress: 42 })
    expect(fetch).toHaveBeenCalledWith('/api/v1/analysis-jobs/job-api', undefined)
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('列表、重新执行和删除记录调用对应接口', async () => {
    vi.stubEnv('VITE_DATA_MODE', 'api')
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'new-job' }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ deletedJobId: 'old-job' }), { status: 200 }))
    vi.stubGlobal('fetch', fetcher)

    await expect(listAnalysisJobs()).resolves.toEqual([])
    await rerunAnalysisJob('paper/a', 'replace')
    await deleteAnalysisJob('old/job')

    expect(fetcher).toHaveBeenNthCalledWith(1, '/api/v1/analysis-jobs?limit=100', undefined)
    expect(fetcher).toHaveBeenNthCalledWith(2, '/api/v1/papers/paper%2Fa/analysis-jobs', {
      method: 'POST', body: JSON.stringify({ resultMode: 'replace' }),
    })
    expect(fetcher).toHaveBeenNthCalledWith(3, '/api/v1/analysis-jobs/old%2Fjob', {
      method: 'DELETE',
    })
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })
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
