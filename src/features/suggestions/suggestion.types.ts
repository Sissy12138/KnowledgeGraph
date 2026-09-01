import type {
  Evidence,
  ProposedChange,
  ResolutionCandidate,
  Suggestion as SuggestionDto,
  SuggestionExecutionResult,
  SuggestionOperation,
  SuggestionPage as SuggestionPageDto,
  SuggestionPaperSummary,
  SuggestionStatus,
  SuggestionStatusCounts,
} from '../../contracts/v05.types'

export type {
  Evidence as SuggestionEvidence,
  ResolutionCandidate,
  SuggestionExecutionResult,
  SuggestionOperation,
  SuggestionPaperSummary,
  SuggestionStatus,
  SuggestionStatusCounts,
}

export type ReviewedSuggestionStatus = Extract<SuggestionStatus, 'accepted' | 'rejected'>

export type SuggestionCandidateState =
  | 'current'
  | 'staleExtraction'
  | 'history'
  | 'notApplicable'

/** v05 Suggestion DTO 加上当前页论文、Evidence 与最新 Extraction 候选连接结果。 */
export type Suggestion = Omit<SuggestionDto, 'evidenceIds' | 'proposedChange' | 'executionResult'> & {
  paperTitle: string
  evidence: Evidence[]
  candidates: ResolutionCandidate[]
  candidateState: SuggestionCandidateState
  canReview: boolean
  proposedChange: ProposedChange
  executionResult: SuggestionExecutionResult | null
}

/** 页面稳定使用的分页 ViewModel；保留 v05 的池与状态计数。 */
export type SuggestionPage = Omit<SuggestionPageDto, 'items'> & {
  items: Suggestion[]
  totalPages: number
}
