import type {
  AuthorDetail as AuthorDetailDto,
  JournalInfo as JournalInfoDto,
  PageResult,
  PaperDetail as PaperDetailDto,
  PaperSummary as PaperSummaryDto,
} from '../../contracts/v05.types'
import type {
  AuthorDetailView,
  JournalView,
  PaperDetail,
  PaperMetricSource,
  PaperPage,
  PaperSummary,
} from './paper.types'

function toJournalView(
  dto: JournalInfoDto,
  metricSource: PaperMetricSource,
): JournalView {
  const metrics = metricSource === 'mock' ? dto.metrics : null

  return {
    name: dto.name,
    issn: dto.issn,
    impactFactor: metrics?.impactFactor ?? null,
    impactFactorYear: metrics?.jcrDataYear ?? null,
    categories: metrics?.categories.map((category) => ({ ...category })) ?? [],
  }
}

/** 将 v05 论文摘要 DTO 转为页面稳定使用的 ViewModel。 */
export function toPaperSummaryView(
  dto: PaperSummaryDto,
  metricSource: PaperMetricSource,
): PaperSummary {
  return {
    id: dto.id,
    title: dto.title,
    authors: [...dto.authors]
      .sort((left, right) => left.authorOrder - right.authorOrder)
      .map((author) => ({
        id: author.authorId,
        name: author.displayName,
        rawName: author.rawName,
        order: author.authorOrder,
      })),
    year: dto.year,
    doi: dto.doi,
    journal: dto.journal ? toJournalView(dto.journal, metricSource) : null,
    metricSource,
    status: dto.status,
    latestJobId: dto.latestJobId,
    pendingSuggestionCount: dto.pendingSuggestionCount,
    createdAt: dto.createdAt,
    updatedAt: dto.updatedAt,
  }
}

/** 将 v05 论文详情 DTO 转为页面 ViewModel。 */
export function toPaperDetailView(
  dto: PaperDetailDto,
  metricSource: PaperMetricSource,
): PaperDetail {
  return {
    ...toPaperSummaryView(dto, metricSource),
    abstract: dto.abstract,
    source: { ...dto.source },
    latestExtractionId: dto.latestExtractionId,
    researchOverview: dto.researchOverview
      ? {
          ...dto.researchOverview,
          researchTopics: [...dto.researchOverview.researchTopics],
        }
      : null,
  }
}

/** 从 v05 分页元数据派生页面所需的总页数。 */
export function toPaperPageView(
  dto: PageResult<PaperSummaryDto>,
  metricSource: PaperMetricSource,
): PaperPage {
  return {
    items: dto.items.map((item) => toPaperSummaryView(item, metricSource)),
    page: dto.page,
    pageSize: dto.pageSize,
    total: dto.total,
    totalPages: dto.pageSize > 0 ? Math.ceil(dto.total / dto.pageSize) : 0,
  }
}

/** 保留 ORCID 来源，并仅认可 ORCID OAuth 返回的认证状态。 */
export function toAuthorDetailView(dto: AuthorDetailDto): AuthorDetailView {
  const { externalIds } = dto

  return {
    id: dto.id,
    name: dto.displayName,
    nameVariants: [...dto.nameVariants],
    affiliations: dto.affiliations.map((affiliation) => ({ ...affiliation })),
    identityStatus: dto.identityStatus,
    mergedIntoAuthorId: dto.mergedIntoAuthorId,
    orcid: externalIds.orcid
      ? {
          value: externalIds.orcid,
          source: externalIds.orcidSource,
          authenticated:
            externalIds.orcidSource === 'orcidOAuth'
            && externalIds.orcidAuthenticated,
        }
      : null,
    paperCount: dto.paperCount,
    createdAt: dto.createdAt,
    updatedAt: dto.updatedAt,
  }
}
