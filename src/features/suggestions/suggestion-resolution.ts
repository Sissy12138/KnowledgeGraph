import type {
  ResolutionCandidate,
  ResolutionSelection,
  Suggestion,
} from './suggestion.types'

export const DEFAULT_CANDIDATE_THRESHOLD = 0.7
export const MAX_CANDIDATE_SELECTIONS = 3

/** 返回达到阈值的最高置信度候选；用于单卡初始状态与批量审核。 */
export function getDefaultCandidateIds(
  candidates: ResolutionCandidate[],
  threshold = DEFAULT_CANDIDATE_THRESHOLD,
): string[] {
  const highest = candidates.reduce<ResolutionCandidate | null>(
    (current, candidate) =>
      current === null || candidate.confidence > current.confidence
        ? candidate
        : current,
    null,
  )

  return highest && highest.confidence >= threshold ? [highest.id] : []
}

/** 切换候选选择；到达上限时保持原选择不变。 */
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

function normalizeName(name: string) {
  return name.trim().toLocaleLowerCase('zh-CN')
}

/** 检查新节点规范名称是否与当前已有候选重名。 */
export function resolveNewCandidateName(
  name: string,
  candidates: ResolutionCandidate[],
) {
  const normalizedName = name.trim()
  const normalizedKey = normalizeName(name)
  const matchingExisting = candidates.find(
    (candidate) =>
      candidate.kind === 'existing' &&
      normalizeName(candidate.name) === normalizedKey,
  )

  return {
    normalizedName,
    matchingExistingCandidateId: matchingExisting?.id ?? null,
  }
}

/** 把前端候选选择转换成可交给后端的明确建点/连边决定。 */
export function buildResolutionSelections(
  suggestion: Suggestion,
  selectedIds: string[],
  nameOverrides: Record<string, string> = {},
): ResolutionSelection[] {
  const candidates = suggestion.candidates ?? []
  return selectedIds.flatMap((id) => {
    const candidate = candidates.find((item) => item.id === id)
    if (!candidate) return []
    return [{
      candidateId: candidate.id,
      operation: candidate.kind === 'existing' ? 'linkExisting' : 'createNew',
      targetEntityId: candidate.targetEntityId,
      name: nameOverrides[id]?.trim() || candidate.name,
      confidence: candidate.confidence,
    }]
  })
}
