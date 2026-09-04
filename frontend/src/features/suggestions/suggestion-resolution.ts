import type {
  AcceptSuggestionRequest as AcceptSuggestionRequestDto,
  RejectSuggestionRequest as RejectSuggestionRequestDto,
} from '../../contracts/v05.types'
import type { Suggestion } from './suggestion.types'

export const MAX_CANDIDATE_SELECTIONS = 3

function isResolveSuggestion(suggestion: Suggestion): boolean {
  return suggestion.operation === 'resolveConceptMatch'
    || suggestion.operation === 'resolveMethodMatch'
}

/** 仅使用后端明确返回的默认候选；推荐分数不构成前端阈值。 */
export function getDefaultCandidateIds(suggestion: Suggestion): string[] {
  const change = suggestion.proposedChange
  const id = change.type === 'resolveConceptMatch'
    || change.type === 'resolveMethodMatch'
    ? change.defaultCandidateId
    : null
  return id ? [id] : []
}

/** 切换候选选择；到达 v05 上限时保持原选择不变。 */
export function toggleCandidateSelection(
  selectedIds: string[],
  candidateId: string,
  maxSelections = MAX_CANDIDATE_SELECTIONS,
): string[] {
  if (selectedIds.includes(candidateId)) {
    return selectedIds.filter((id) => id !== candidateId)
  }
  return selectedIds.length >= maxSelections
    ? selectedIds
    : [...selectedIds, candidateId]
}

/** 把界面选择转换为 v05 接受请求；Existing 永不携带名称覆盖。 */
export function buildAcceptSuggestionRequest(
  suggestion: Suggestion,
  selectedIds: string[],
  labelOverrides: Record<string, string>,
  comment: string | null,
): AcceptSuggestionRequestDto {
  if (!isResolveSuggestion(suggestion)) {
    return { comment: comment?.trim() || null, resolution: null }
  }

  if (selectedIds.length < 1 || selectedIds.length > MAX_CANDIDATE_SELECTIONS) {
    throw new Error('实体消歧必须选择一至三个候选')
  }
  if (new Set(selectedIds).size !== selectedIds.length) {
    throw new Error('实体消歧候选不得重复')
  }

  const candidates = selectedIds.map((candidateId) => {
    const candidate = suggestion.candidates.find((item) => item.id === candidateId)
    if (!candidate) throw new Error('实体消歧包含无效候选')
    return candidate
  })
  if (candidates.filter((candidate) => candidate.kind === 'new').length > 1) {
    throw new Error('实体消歧最多只能选择一个 New 候选')
  }

  return {
    comment: comment?.trim() || null,
    resolution: {
      selectedTargets: candidates.map((candidate) => ({
        candidateId: candidate.id,
        labelOverride: candidate.kind === 'new'
          ? labelOverrides[candidate.id]?.trim() || null
          : null,
      })),
    },
  }
}

/** 把可选拒绝原因转换为 v05 请求体。 */
export function buildRejectSuggestionRequest(
  reason: string | null,
): RejectSuggestionRequestDto {
  return { reason: reason?.trim() || null }
}
