
export type PaperStatus =
  | 'unprocessed'
  | 'queued'
  | 'processing'
  | 'pendingReview'
  | 'completed'
  | 'failed'

export type AuthorSummary = {
  id: string | null
  name: string
}

export type Author = AuthorSummary & {
  affiliation: string | null
  orcid: string | null
}

export type PaperSource = {
  type: 'zotero' | 'academicSearch' | 'manual'
  externalId: string | null
  url: string | null
}

export type ResearchOverview = {
  researchTopics: string[]
  researchQuestion: string | null
  sample: string | null
  methods: string | null
  mainResults: string | null
}

export type PaperSummary = {
  id: string
  title: string
  authors: AuthorSummary[]
  year: number | null
  doi: string | null
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

export type PaperDetail = {
  id: string
  title: string
  authors: Author[]
  year: number | null
  doi: string | null
  abstract: string | null
  source: PaperSource
  status: PaperStatus
  latestJobId: string | null
  latestExtractionId: string | null
  pendingSuggestionCount: number
  researchOverview: ResearchOverview | null
  createdAt: string
  updatedAt: string
}
