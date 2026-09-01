import type {
  PageResult,
  PaperSummary as PaperSummaryDto,
} from '../../contracts/v05.types'
import { toPaperPageView } from './paper.adapter'
import type { PaperListScenario } from './paper.types'

/** 模拟 GET /api/v1/papers 成功时返回的完整分页响应。 */
export const paperPageDtoMock: PageResult<PaperSummaryDto> = {
  items: [
    {
      id: 'paper-001',
      title: '反转学习中的认知灵活性与前额叶活动',
      authors: [
        { authorId: 'author-wang-fang', displayName: '王芳', rawName: 'Wang Fang', authorOrder: 2 },
        { authorId: 'author-li-ming', displayName: '李明', rawName: 'Li Ming', authorOrder: 1 },
      ],
      year: 2025,
      doi: '10.1000/yzt.2025.001',
      journal: {
        name: 'Nature Neuroscience',
        issn: '1097-6256',
        metrics: {
          impactFactor: 25,
          jcrDataYear: 2024,
          categories: [{ category: 'Neurosciences', quartile: 'Q1' }],
          metricSource: 'JCR',
        },
      },
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
        { authorId: 'author-chen-wei', displayName: '陈伟', rawName: 'Chen Wei', authorOrder: 3 },
        { authorId: 'author-li-ming', displayName: '李明', rawName: 'Li Ming', authorOrder: 1 },
        { authorId: 'author-wang-fang', displayName: '王芳', rawName: 'Wang Fang', authorOrder: 2 },
      ],
      year: 2024,
      doi: null,
      journal: {
        name: 'Neuron',
        issn: '0896-6273',
        metrics: {
          impactFactor: 16.2,
          jcrDataYear: 2024,
          categories: [{ category: 'Neurosciences', quartile: 'Q1' }],
          metricSource: 'JCR',
        },
      },
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
        { authorId: 'author-zhao-jing', displayName: '赵静', rawName: 'Zhao Jing', authorOrder: 2 },
        { authorId: 'author-chen-wei', displayName: '陈伟', rawName: 'Chen Wei', authorOrder: 1 },
      ],
      year: 2023,
      doi: null,
      journal: {
        name: 'Cerebral Cortex',
        issn: '1047-3211',
        metrics: {
          impactFactor: 4.2,
          jcrDataYear: 2024,
          categories: [{ category: 'Neurosciences', quartile: 'Q2' }],
          metricSource: 'JCR',
        },
      },
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
        { authorId: 'author-zhou-ning', displayName: '周宁', rawName: 'Zhou Ning', authorOrder: 1 },
        { authorId: 'author-sun-yue', displayName: '孙悦', rawName: 'Sun Yue', authorOrder: 2 },
      ],
      year: 2022,
      doi: null,
      journal: null,
      status: 'failed',
      latestJobId: 'job-004',
      pendingSuggestionCount: 0,
      createdAt: '2026-08-25T06:00:00Z',
      updatedAt: '2026-08-26T10:05:00Z',
    },
    {
      id: 'paper-005',
      title: '可重复的任务切换数据集',
      authors: [{ authorId: 'author-wu-lan', displayName: '吴兰', rawName: 'Wu Lan', authorOrder: 1 }],
      year: 2021,
      doi: null,
      journal: { name: 'Open Science Journal', issn: null, metrics: null },
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
}

export const emptyPaperPageDtoMock: PageResult<PaperSummaryDto> = {
  items: [],
  page: 1,
  pageSize: 20,
  total: 0,
}

/** 按页面场景返回 v05 DTO Mock。 */
export function getPaperPageMock(
  scenario: PaperListScenario,
): PageResult<PaperSummaryDto> {
  if (scenario === 'error') {
    throw new Error('论文列表加载失败，请稍后重试。')
  }

  return scenario === 'empty' ? emptyPaperPageDtoMock : paperPageDtoMock
}

/** 兼容既有页面测试；数据仍由同一 DTO 适配器生成。 */
export const paperListMock = toPaperPageView(
  structuredClone(paperPageDtoMock),
  'mock',
)

export const emptyPaperListMock = toPaperPageView(
  structuredClone(emptyPaperPageDtoMock),
  'mock',
)
