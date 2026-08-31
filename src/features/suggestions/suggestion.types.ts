export type SuggestionStatus = 'pending' | 'accepted' | 'rejected'

export type ReviewedSuggestionStatus = Exclude<SuggestionStatus, 'pending'>

export type SuggestionAction =
  | 'addConcept'
  | 'addMethod'
  | 'addFinding'
  | 'addRelation'

export interface SuggestionEvidence {
  id: string
  paperId: string
  section: string | null
  text: string
}

export type ResolutionEntityType = 'concept' | 'method'

export type ResolutionCandidateKind = 'existing' | 'new'

export interface ResolutionCandidate {
  id: string
  kind: ResolutionCandidateKind
  entityType: ResolutionEntityType
  targetEntityId: string | null
  name: string
  originalName: string
  confidence: number
}

export interface ResolutionSelection {
  candidateId: string
  operation: 'linkExisting' | 'createNew'
  targetEntityId: string | null
  name: string
  confidence: number
}

export interface Suggestion {
  id: string
  paperId: string
  extractionId: string
  action: SuggestionAction
  status: SuggestionStatus
  title: string
  reason: string
  confidence: number | null
  evidence: SuggestionEvidence[]
  candidates?: ResolutionCandidate[]
  resolvedSelections?: ResolutionSelection[]
  proposedChange: Record<string, unknown>
  reviewedAt: string | null
  reviewComment: string | null
  createdAt: string
  updatedAt: string
}

export interface SuggestionPage {
  items: Suggestion[]
  page: number
  pageSize: number
  total: number
  totalPages: number
}
