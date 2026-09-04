export type PageResult<T> = {
  items: T[]
  page: number
  pageSize: number
  total: number
}

export type ApiErrorDetail = {
  code: string
  message: string
  retryable: boolean
  details: Record<string, unknown> | null
  requestId: string
}

export type ApiErrorResponse = {
  error: ApiErrorDetail
}

export type PaperStatus =
  | 'unprocessed'
  | 'queued'
  | 'processing'
  | 'pendingReview'
  | 'completed'
  | 'failed'

export type AnalysisJobStatus =
  | 'queued'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled'

export type AnalysisStage =
  | 'queued'
  | 'preparing'
  | 'parsing'
  | 'analyzing'
  | 'storing'
  | 'completed'
  | 'failed'
  | 'cancelled'

export type SuggestionStatus =
  | 'pending'
  | 'accepted'
  | 'rejected'
  | 'superseded'

export type AuthorIdentityStatus = 'resolved' | 'provisional' | 'merged'

export type AuthorAffiliation = {
  rawText: string
  displayName: string | null
  rorId: string | null
}

export type AuthorExternalIds = {
  orcid: string | null
  orcidSource: 'orcidOAuth' | 'crossref' | 'zotero' | 'pdf' | 'manual' | null
  orcidAuthenticated: boolean
}

export type AuthorSummary = {
  id: string
  displayName: string
  nameVariants: string[]
  externalIds: AuthorExternalIds
  affiliations: AuthorAffiliation[]
  identityStatus: AuthorIdentityStatus
  mergedIntoAuthorId: string | null
}

export type AuthorDetail = AuthorSummary & {
  paperCount: number
  createdAt: string
  updatedAt: string
}

export type PaperAuthor = {
  authorId: string
  displayName: string
  rawName: string
  authorOrder: number
}

export type AuthorCollaboratorSummary = {
  author: AuthorSummary
  sharedPaperCount: number
  sharedPaperIds: string[]
}

export type JournalCategoryMetric = {
  category: string
  quartile: 'Q1' | 'Q2' | 'Q3' | 'Q4'
}

export type JournalMetrics = {
  impactFactor: number | null
  jcrDataYear: number | null
  categories: JournalCategoryMetric[]
  metricSource: 'JCR' | null
}

export type JournalInfo = {
  name: string
  issn: string | null
  metrics: JournalMetrics | null
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
  authors: PaperAuthor[]
  year: number | null
  doi: string | null
  journal: JournalInfo | null
  status: PaperStatus
  latestJobId: string | null
  pendingSuggestionCount: number
  createdAt: string
  updatedAt: string
}

export type PaperDetail = PaperSummary & {
  abstract: string | null
  source: PaperSource
  latestExtractionId: string | null
  researchOverview: ResearchOverview | null
}

export type MethodType =
  | 'behavioralTask'
  | 'electrophysiology'
  | 'imaging'
  | 'intervention'
  | 'molecularCellular'
  | 'computationalModel'
  | 'statisticalAnalysis'
  | 'other'

export type ConceptSummary = {
  id: string
  label: string
  description: string | null
  aliases: string[]
}

export type MethodSummary = {
  id: string
  label: string
  methodType: MethodType
  description: string | null
  aliases: string[]
}

export type MatchStatus = 'matched' | 'uncertain' | 'new'

export type ResolutionCandidate = {
  id: string
  kind: 'existing' | 'new'
  nodeId: string | null
  label: string
  recommendationScore: number | null
}

export type Evidence = {
  id: string
  paperId: string
  section: string | null
  text: string
}

export type ExtractedConcept = {
  id: string
  paperId: string
  rawText: string
  normalizedLabel: string
  matchStatus: MatchStatus
  matchedConceptIds: string[]
  candidates: ResolutionCandidate[]
  extractionConfidence: number | null
  evidenceIds: string[]
}

export type ExtractedMethod = {
  id: string
  paperId: string
  rawText: string
  normalizedLabel: string
  methodType: MethodType
  description: string | null
  matchStatus: MatchStatus
  matchedMethodIds: string[]
  candidates: ResolutionCandidate[]
  extractionConfidence: number | null
  evidenceIds: string[]
}

export type ExtractedFinding = {
  id: string
  paperId: string
  statement: string
  confidence: number | null
  evidenceIds: string[]
}

export type Extraction = {
  id: string
  paperId: string
  analysisJobId: string
  isLatest: boolean
  researchOverview: ResearchOverview
  concepts: ExtractedConcept[]
  methods: ExtractedMethod[]
  findings: ExtractedFinding[]
  evidence: Evidence[]
  createdAt: string
}

export type AnalysisJob = {
  id: string
  paperId: string
  status: AnalysisJobStatus
  progress: number
  stage: AnalysisStage
  error: ApiErrorDetail | null
  createdAt: string
  startedAt: string | null
  completedAt: string | null
}

export type GraphNodeType = 'paper' | 'author' | 'concept' | 'method' | 'finding'

export type RelationType =
  | 'authored'
  | 'coAuthor'
  | 'studies'
  | 'uses'
  | 'reports'
  | 'supports'
  | 'contradicts'
  | 'relatedTo'
  | 'broaderThan'
  | 'cites'

export type SuggestionOperation =
  | 'resolveConceptMatch'
  | 'resolveMethodMatch'
  | 'addFinding'
  | 'addRelation'

export type ResolveConceptMatchChange = {
  type: 'resolveConceptMatch'
  extractedConceptId: string
  candidateIds: string[]
  defaultCandidateId: string | null
  maxSelections: 3
}

export type ResolveMethodMatchChange = {
  type: 'resolveMethodMatch'
  extractedMethodId: string
  candidateIds: string[]
  defaultCandidateId: string | null
  maxSelections: 3
}

export type AddFindingChange = {
  type: 'addFinding'
  extractedFindingId: string
  statement: string
}

export type AddRelationChange = {
  type: 'addRelation'
  sourceId: string
  sourceType: GraphNodeType
  targetId: string
  targetType: GraphNodeType
  relationType: RelationType
}

export type ProposedChange =
  | ResolveConceptMatchChange
  | ResolveMethodMatchChange
  | AddFindingChange
  | AddRelationChange

export type SelectedResolutionTarget = {
  candidateId: string
  labelOverride: string | null
}

export type MultiMatchResolution = {
  selectedTargets: SelectedResolutionTarget[]
}

export type ResolvedTarget = {
  candidateId: string
  nodeId: string
  label: string
  created: boolean
  relationId: string
}

export type SuggestionExecutionResult =
  | {
      type: 'resolveMatch'
      resolvedTargets: ResolvedTarget[]
    }
  | {
      type: 'addFinding'
      nodeId: string
      relationId: string
    }
  | {
      type: 'addRelation'
      relationId: string
    }

export type Suggestion = {
  id: string
  paperId: string
  extractionId: string
  operation: SuggestionOperation
  status: SuggestionStatus
  title: string
  reason: string
  confidence: number | null
  evidenceIds: string[]
  proposedChange: ProposedChange
  executionResult: SuggestionExecutionResult | null
  reviewedAt: string | null
  supersededAt: string | null
  reviewComment: string | null
  createdAt: string
  updatedAt: string
}

export type SuggestionPaperSummary = {
  id: string
  title: string
}

export type SuggestionStatusCounts = {
  pending: number
  accepted: number
  rejected: number
  superseded: number
}

export type SuggestionPage = PageResult<Suggestion> & {
  evidence: Evidence[]
  papers: SuggestionPaperSummary[]
  statusCounts: SuggestionStatusCounts
}

export type AcceptSuggestionRequest = {
  comment: string | null
  resolution: MultiMatchResolution | null
}

export type RejectSuggestionRequest = {
  reason: string | null
}

export type SuggestionDetailResponse = {
  suggestion: Suggestion
  evidence: Evidence[]
  paper: SuggestionPaperSummary
}

export type SuggestionAlreadyReviewedDetails = {
  suggestionId: string
  currentStatus: 'accepted' | 'rejected'
  reviewedAt: string
}

export type SuggestionSupersededDetails = {
  suggestionId: string
  currentStatus: 'superseded'
  supersededAt: string
}

export type GraphNode = {
  id: string
  nodeType: GraphNodeType
  label: string
  description: string | null
  sourcePaperIds: string[]
  createdAt: string
  updatedAt: string
}

export type GraphEdge = {
  id: string
  sourceId: string
  targetId: string
  relationType: RelationType
  label: string
  confidence: number | null
  evidenceIds: string[]
  weight: number | null
  sourcePaperIds: string[]
  createdAt: string
  updatedAt: string
}

export type GraphMeta = {
  focusNodeId: string
  depth: number
  nodeCount: number
  edgeCount: number
  totalMatched: number
  truncated: boolean
}

export type GraphResponse = {
  nodes: GraphNode[]
  edges: GraphEdge[]
  evidence: Evidence[]
  meta: GraphMeta
}
