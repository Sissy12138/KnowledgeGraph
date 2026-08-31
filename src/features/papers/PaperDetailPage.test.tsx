import { render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import type { AnalysisJob } from '../analysis/analysis-job.types'
import type { PaperDetail } from './paper.types'
import PaperDetailPage from './PaperDetailPage'

const paperDetail: PaperDetail = {
  id: 'paper-test',
  title: '用于详情测试的论文',
  authors: [
    {
      id: null,
      name: '测试作者',
      affiliation: '测试实验室',
      orcid: null,
    },
  ],
  year: 2026,
  doi: null,
  abstract: '这是一段用于验证详情页的摘要。',
  source: { type: 'manual', externalId: null, url: null },
  status: 'pendingReview',
  latestJobId: 'job-test',
  latestExtractionId: 'extraction-test',
  pendingSuggestionCount: 1,
  researchOverview: {
    researchTopics: ['测试主题'],
    researchQuestion: '详情页面能否正确显示？',
    sample: '10 名参与者',
    methods: '测试方法',
    mainResults: '详情页面显示成功。',
  },
  createdAt: '2026-08-29T08:00:00Z',
  updatedAt: '2026-08-29T08:00:00Z',
}

const completedJob: AnalysisJob = {
  id: 'job-test',
  paperId: 'paper-test',
  status: 'completed',
  progress: 100,
  stage: 'completed',
  error: null,
  createdAt: '2026-08-29T08:00:00Z',
  startedAt: '2026-08-29T08:00:02Z',
  completedAt: '2026-08-29T08:01:00Z',
}

function renderDetail(loadPaper: (paperId: string) => Promise<PaperDetail>) {
  return render(
    <MemoryRouter initialEntries={['/papers/paper-test']}>
      <Routes>
        <Route
          path="/papers/:paperId"
          element={
            <PaperDetailPage
              loadPaper={loadPaper}
              loadAnalysisJob={async () => completedJob}
            />
          }
        />
      </Routes>
    </MemoryRouter>,
  )
}

describe('PaperDetailPage', () => {
  it('请求未完成时显示加载状态', () => {
    renderDetail(() => new Promise<PaperDetail>(() => undefined))

    expect(screen.getByRole('status')).toHaveTextContent('正在加载论文详情')
  })

  it('加载成功后显示论文详情和研究概览', async () => {
    renderDetail(async () => paperDetail)

    expect(
      await screen.findByRole('heading', { name: '用于详情测试的论文' }),
    ).toBeInTheDocument()
    expect(screen.getByText('详情页面能否正确显示？')).toBeInTheDocument()
    const paperHeader = screen.getByRole('banner')
    expect(
      await within(paperHeader).findByLabelText('解析进度'),
    ).toBeInTheDocument()
    expect(await within(paperHeader).findByRole('progressbar')).toHaveAttribute(
      'aria-valuenow',
      '100',
    )
    expect(screen.getByRole('link', { name: /返回论文库/ })).toHaveAttribute(
      'href',
      '/papers',
    )
  })

  it('论文不存在时显示错误和返回入口', async () => {
    renderDetail(async () => {
      throw new Error('论文不存在。')
    })

    expect(await screen.findByRole('alert')).toHaveTextContent('论文不存在。')
    expect(screen.getByRole('link', { name: '返回论文库' })).toBeInTheDocument()
  })
})
