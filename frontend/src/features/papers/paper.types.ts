import type {
  AuthorAffiliation,
  AuthorExternalIds,
  AuthorIdentityStatus,
  JournalCategoryMetric,
  PaperSource,
  PaperStatus,
  ResearchOverview,
} from '../../contracts/v05.types'

export type { PaperSource, PaperStatus, ResearchOverview }

export type PaperMetricSource = 'mock' | 'unavailable'

export type AuthorSummary = {
  id: string
  name: string
  rawName: string
  order: number
}

export type Author = AuthorSummary

export type AuthorOrcid = {
  value: string
  source: AuthorExternalIds['orcidSource']
  authenticated: boolean
}

export type AuthorDetailView = {
  id: string
  name: string
  nameVariants: string[]
  affiliations: AuthorAffiliation[]
  identityStatus: AuthorIdentityStatus
  mergedIntoAuthorId: string | null
  orcid: AuthorOrcid | null
  paperCount: number
  createdAt: string
  updatedAt: string
}

export type JournalView = {
  name: string
  issn: string | null
  impactFactor: number | null
  impactFactorYear: number | null
  categories: JournalCategoryMetric[]
}

export type PaperSummary = {
  id: string
  title: string
  authors: AuthorSummary[]
  year: number | null
  doi: string | null
  journal: JournalView | null
  metricSource: PaperMetricSource
  status: PaperStatus
  latestJobId: string | null
  pendingSuggestionCount: number
  createdAt: string
  updatedAt: string
}

export type PaperPage = {
  items: PaperSummary[]
  page: number
  pageSize: number
  total: number
  totalPages: number
}

export type PaperListScenario = 'success' | 'empty' | 'error'

export type PaperDetail = PaperSummary & {
  abstract: string | null
  source: PaperSource
  latestExtractionId: string | null
  researchOverview: ResearchOverview | null
}
