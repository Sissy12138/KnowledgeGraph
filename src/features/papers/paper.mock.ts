import type { PaperPage } from './paper.types'

/** 模拟 GET /api/v1/papers 成功时返回的完整分页响应。 */
export const paperListMock: PaperPage = {
  items: [
    {
      id: 'paper-001',
      title: '反转学习中的认知灵活性与前额叶活动',
      authors: [
        { id: 'author-li-ming', name: '李明' },
        { id: 'author-wang-fang', name: '王芳' },
      ],
      year: 2025,
      doi: '10.1000/yzt.2025.001',
      status: 'pendingReview',
      latestJobId: 'job-001',
      pendingSuggestionCount: 2,
      createdAt: '2026-08-20T08:00:00Z',
      updatedAt: '2026-08-26T09:10:00Z',
    },
    {
      id: 'paper-002',
      title: '价值更新中的网络动力学',
      authors: [
        { id: 'author-li-ming', name: '李明' },
        { id: 'author-wang-fang', name: '王芳' },
        { id: 'author-chen-wei', name: '陈伟' },
      ],
      year: 2024,
      doi: null,
      status: 'completed',
      latestJobId: 'job-002',
      pendingSuggestionCount: 0,
      createdAt: '2026-08-19T08:00:00Z',
      updatedAt: '2026-08-25T12:00:00Z',
    },
    {
      id: 'paper-003',
      title: '适应性决策的脑电标记',
      authors: [
        { id: 'author-chen-wei', name: '陈伟' },
        { id: 'author-zhao-jing', name: '赵静' },
      ],
      year: 2023,
      doi: null,
      status: 'processing',
      latestJobId: 'job-003',
      pendingSuggestionCount: 0,
      createdAt: '2026-08-26T07:30:00Z',
      updatedAt: '2026-08-26T10:00:00Z',
    },
    {
      id: 'paper-004',
      title: '人类层级强化学习',
      authors: [
        { id: 'author-zhou-ning', name: '周宁' },
        { id: 'author-sun-yue', name: '孙悦' },
      ],
      year: 2022,
      doi: null,
      status: 'failed',
      latestJobId: 'job-004',
      pendingSuggestionCount: 0,
      createdAt: '2026-08-25T06:00:00Z',
      updatedAt: '2026-08-26T10:05:00Z',
    },
    {
      id: 'paper-005',
      title: '可重复的任务切换数据集',
      authors: [{ id: 'author-wu-lan', name: '吴兰' }],
      year: 2021,
      doi: null,
      status: 'completed',
      latestJobId: null,
      pendingSuggestionCount: 0,
      createdAt: '2026-08-18T06:00:00Z',
      updatedAt: '2026-08-24T10:05:00Z',
    },
  ],
  page: 1,
  pageSize: 20,
  total: 5,
  totalPages: 1,
}

export const emptyPaperListMock: PaperPage = {
  items: [],
  page: 1,
  pageSize: 20,
  total: 0,
  totalPages: 0,
}
