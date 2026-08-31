import { emptyPaperListMock, paperListMock } from './paper.mock'
import { paperDetailMocks } from './paper-detail.mock'
import type {
  PaperDetail,
  PaperListScenario,
  PaperPage,
} from './paper.types'

/**
 * 获取论文分页数据。
 * 当前读取 Mock；接入 A 的接口后，只需替换本函数内部实现。
 */
export async function getPapers(
  scenario: PaperListScenario = 'success',
): Promise<PaperPage> {
  if (scenario === 'error') {
    throw new Error('论文列表加载失败，请稍后重试。')
  }

  const response = scenario === 'empty' ? emptyPaperListMock : paperListMock
  return structuredClone(response)
}

/** 根据稳定字符串 ID 获取单篇论文详情。 */
export async function getPaperDetail(paperId: string): Promise<PaperDetail> {
  const paper = paperDetailMocks.find((item) => item.id === paperId)

  if (!paper) {
    throw new Error('论文不存在。')
  }

  return structuredClone(paper)
}
