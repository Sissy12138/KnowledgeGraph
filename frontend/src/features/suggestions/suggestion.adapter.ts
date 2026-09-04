import type {
  Evidence,
  Extraction as ExtractionDto,
  ResolutionCandidate,
  Suggestion as SuggestionDto,
  SuggestionPage as SuggestionPageDto,
} from '../../contracts/v05.types'
import type { Suggestion, SuggestionCandidateState, SuggestionPage } from './suggestion.types'

type LatestExtractionsByPaperId = Record<string, ExtractionDto | undefined>

function resolveCandidates(
  dto: SuggestionDto,
  latestExtraction: ExtractionDto | undefined,
): ResolutionCandidate[] | null {
  if (latestExtraction?.id !== dto.extractionId) return null

  const change = dto.proposedChange
  if (change.type !== 'resolveConceptMatch' && change.type !== 'resolveMethodMatch') {
    return null
  }
  const extracted = change.type === 'resolveConceptMatch'
    ? latestExtraction.concepts.find((item) => item.id === change.extractedConceptId)
    : latestExtraction.methods.find((item) => item.id === change.extractedMethodId)
  if (!extracted) return null

  const candidateById = new Map(extracted.candidates.map((candidate) => [candidate.id, candidate]))
  const candidates = change.candidateIds.flatMap((id) => {
    const candidate = candidateById.get(id)
    return candidate ? [{ ...candidate }] : []
  })
  return candidates.length === change.candidateIds.length ? candidates : null
}

/** 连接单条 Suggestion 的当前页池；旧审核结果不反向伪造候选。 */
export function toSuggestionView(
  dto: SuggestionDto,
  evidenceById: ReadonlyMap<string, Evidence>,
  paperTitle: string,
  latestExtraction: ExtractionDto | undefined,
): Suggestion {
  const isResolve = dto.operation === 'resolveConceptMatch' || dto.operation === 'resolveMethodMatch'
  let candidates: ResolutionCandidate[] = []
  let candidateState: SuggestionCandidateState = 'notApplicable'

  if (isResolve && dto.status === 'pending') {
    const currentCandidates = resolveCandidates(dto, latestExtraction)
    candidates = currentCandidates ?? []
    candidateState = currentCandidates ? 'current' : 'staleExtraction'
  } else if (isResolve && (dto.status === 'accepted' || dto.status === 'rejected')) {
    candidateState = 'history'
  } else if (isResolve) {
    candidateState = 'staleExtraction'
  }

  return {
    ...structuredClone(dto),
    paperTitle,
    evidence: dto.evidenceIds.flatMap((id) => {
      const evidence = evidenceById.get(id)
      return evidence ? [{ ...evidence }] : []
    }),
    candidates,
    candidateState,
    canReview: dto.status === 'pending' && (!isResolve || candidateState === 'current'),
  }
}

/** 按 v05 当前页 papers/evidence 池和同论文 latest Extraction 生成页面 ViewModel。 */
export function toSuggestionPageView(
  dto: SuggestionPageDto,
  latestExtractionsByPaperId: LatestExtractionsByPaperId,
): SuggestionPage {
  const evidenceById = new Map(dto.evidence.map((item) => [item.id, item]))
  const paperTitleById = new Map(dto.papers.map((item) => [item.id, item.title]))

  return {
    ...structuredClone(dto),
    items: dto.items.map((item) => toSuggestionView(
      item,
      evidenceById,
      paperTitleById.get(item.paperId) ?? `未知论文（${item.paperId}）`,
      latestExtractionsByPaperId[item.paperId],
    )),
    totalPages: dto.pageSize > 0 ? Math.ceil(dto.total / dto.pageSize) : 0,
  }
}
