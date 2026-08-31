import { suggestionMocks } from './suggestion.mock'
import type {
  ResolutionSelection,
  Suggestion,
  SuggestionPage,
  ReviewedSuggestionStatus,
  SuggestionStatus,
} from './suggestion.types'
import { buildResolutionSelections, getDefaultCandidateIds } from './suggestion-resolution'

export interface AcceptSuggestionInput {
  reviewComment?: string | null
  selections?: ResolutionSelection[]
}

export interface ReviewSuggestionsInput {
  ids: string[]
  status: ReviewedSuggestionStatus
  reviewComment?: string | null
  selectionsById?: Record<string, ResolutionSelection[]>
}

export interface BatchReviewFailure {
  id: string
  error: SuggestionApiError
}

export interface BatchReviewResult {
  updated: Suggestion[]
  failures: BatchReviewFailure[]
}

export interface SuggestionService {
  listSuggestions(status?: SuggestionStatus): Promise<SuggestionPage>
  listAllSuggestions(): Promise<Suggestion[]>
  acceptSuggestion(
    id: string,
    input?: AcceptSuggestionInput | string | null,
  ): Promise<Suggestion>
  rejectSuggestion(id: string, reviewComment?: string | null): Promise<Suggestion>
  reviewSuggestions(input: ReviewSuggestionsInput): Promise<BatchReviewResult>
}

export class SuggestionApiError extends Error {
  readonly status: number
  readonly code: string

  constructor(
    status: number,
    code: string,
    message: string,
  ) {
    super(message)
    this.name = 'SuggestionApiError'
    this.status = status
    this.code = code
  }
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

/** 创建一个有状态的 Mock 服务；同一实例会记住审核结果。 */
export function createMockSuggestionService(
  initialSuggestions: Suggestion[] = suggestionMocks,
): SuggestionService {
  let suggestions = clone(initialSuggestions)

  async function reviewSuggestion(
    id: string,
    status: ReviewedSuggestionStatus,
    reviewComment: string | null = null,
    selections?: ResolutionSelection[],
  ): Promise<Suggestion> {
    const index = suggestions.findIndex((item) => item.id === id)

    if (index < 0) {
      throw new SuggestionApiError(404, 'SUGGESTION_NOT_FOUND', '建议不存在')
    }

    if (suggestions[index].status !== 'pending') {
      throw new SuggestionApiError(
        409,
        'SUGGESTION_ALREADY_REVIEWED',
        '该建议已经完成审核',
      )
    }

    const suggestion = suggestions[index]
    const requiresResolution =
      status === 'accepted' && (suggestion.candidates?.length ?? 0) > 0
    const resolvedSelections = requiresResolution
      ? selections ?? buildResolutionSelections(
          suggestion,
          getDefaultCandidateIds(suggestion.candidates ?? []),
        )
      : undefined

    if (
      requiresResolution &&
      (!resolvedSelections ||
        resolvedSelections.length === 0 ||
        resolvedSelections.length > 3 ||
        resolvedSelections.some(
          (selection) =>
            !suggestion.candidates?.some(
              (candidate) => candidate.id === selection.candidateId,
            ),
        ))
    ) {
      throw new SuggestionApiError(
        400,
        'INVALID_RESOLUTION_SELECTIONS',
        '实体消歧必须选择一至三个有效候选',
      )
    }

    const reviewedAt =
      status === 'accepted'
        ? '2026-08-29T10:30:00Z'
        : '2026-08-29T10:32:00Z'
    const updated: Suggestion = {
      ...suggestions[index],
      status,
      reviewedAt,
      reviewComment,
      resolvedSelections,
      updatedAt: reviewedAt,
    }

    suggestions[index] = updated
    return clone(updated)
  }

  return {
    async listSuggestions(status = 'pending') {
      const items = suggestions.filter((item) => item.status === status)
      return {
        items: clone(items),
        page: 1,
        pageSize: 20,
        total: items.length,
        totalPages: items.length > 0 ? 1 : 0,
      }
    },
    async listAllSuggestions() {
      return clone(suggestions)
    },
    acceptSuggestion(id, input = null) {
      if (typeof input === 'string' || input === null) {
        return reviewSuggestion(id, 'accepted', input)
      }
      return reviewSuggestion(
        id,
        'accepted',
        input.reviewComment ?? null,
        input.selections,
      )
    },
    rejectSuggestion(id, reviewComment = null) {
      return reviewSuggestion(id, 'rejected', reviewComment)
    },
    async reviewSuggestions(input) {
      const settled = await Promise.allSettled(
        input.ids.map((id) =>
          reviewSuggestion(
            id,
            input.status,
            input.reviewComment ?? null,
            input.selectionsById?.[id],
          ),
        ),
      )
      const updated: Suggestion[] = []
      const failures: BatchReviewFailure[] = []

      settled.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          updated.push(result.value)
          return
        }

        const error =
          result.reason instanceof SuggestionApiError
            ? result.reason
            : new SuggestionApiError(500, 'SUGGESTION_REVIEW_FAILED', '审核失败')
        failures.push({ id: input.ids[index], error })
      })

      return { updated, failures }
    },
  }
}

export const suggestionService = createMockSuggestionService()
