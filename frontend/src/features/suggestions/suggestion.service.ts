import { ApiClientError, requestJson } from '../../contracts/api-client'
import { getDataMode } from '../../contracts/data-mode'
import type {
  AcceptSuggestionRequest as AcceptSuggestionRequestDto,
  Extraction as ExtractionDto,
  RejectSuggestionRequest as RejectSuggestionRequestDto,
  Suggestion as SuggestionDto,
  SuggestionPage as SuggestionPageDto,
} from '../../contracts/v05.types'
import { toSuggestionPageView } from './suggestion.adapter'
import { extractionDtoMocks, suggestionPageDtoMock } from './suggestion.mock'
import {
  buildAcceptSuggestionRequest,
  buildRejectSuggestionRequest,
  getDefaultCandidateIds,
} from './suggestion-resolution'
import type {
  ReviewedSuggestionStatus,
  Suggestion,
  SuggestionPage,
  SuggestionStatus,
} from './suggestion.types'

export interface AcceptSuggestionInput {
  selectedIds?: string[]
  labelOverrides?: Record<string, string>
  comment?: string | null
}

export interface ReviewSuggestionsInput {
  ids: string[]
  status: ReviewedSuggestionStatus
  comment?: string | null
}

export interface BatchReviewFailure {
  id: string
  error: ApiClientError
}

export interface BatchReviewResult {
  updated: Suggestion[]
  failures: BatchReviewFailure[]
  skipped: string[]
}

export interface SuggestionService {
  listSuggestions(status?: SuggestionStatus): Promise<SuggestionPage>
  listAllSuggestions(): Promise<Suggestion[]>
  acceptSuggestion(id: string, input?: AcceptSuggestionInput): Promise<Suggestion>
  rejectSuggestion(id: string, reason?: string | null): Promise<Suggestion>
  reviewSuggestions(input: ReviewSuggestionsInput): Promise<BatchReviewResult>
  prime(page: SuggestionPageDto, latestExtractions: Record<string, ExtractionDto>): void
}

function apiError(
  status: number,
  code: string,
  message: string,
  details: Record<string, unknown> | null = null,
): ApiClientError {
  return new ApiClientError(status, {
    code,
    message,
    retryable: false,
    details,
    requestId: 'mock-request',
  })
}

function isResolve(suggestion: Suggestion): boolean {
  return suggestion.operation === 'resolveConceptMatch'
    || suggestion.operation === 'resolveMethodMatch'
}

function scopePage(
  source: SuggestionPageDto,
  status?: SuggestionStatus,
): SuggestionPageDto {
  const items = status
    ? source.items.filter((item) => item.status === status)
    : [...source.items]
  const paperIds = new Set(items.map((item) => item.paperId))
  const evidenceIds = new Set(items.flatMap((item) => item.evidenceIds))

  return {
    ...structuredClone(source),
    items: structuredClone(items),
    total: items.length,
    evidence: source.evidence.filter((item) => evidenceIds.has(item.id)).map((item) => ({ ...item })),
    papers: source.papers.filter((item) => paperIds.has(item.id)).map((item) => ({ ...item })),
  }
}

function postJsonInit(body: AcceptSuggestionRequestDto | RejectSuggestionRequestDto): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}

/** 加载公开 latest Extraction；禁止调用内部候选匹配接口。 */
export async function loadLatestExtraction(paperId: string): Promise<ExtractionDto> {
  if (getDataMode() === 'api') {
    return requestJson<ExtractionDto>(
      `/api/v1/papers/${encodeURIComponent(paperId)}/extractions/latest`,
    )
  }

  const extraction = extractionDtoMocks[paperId]
  if (!extraction) {
    throw apiError(404, 'EXTRACTION_NOT_FOUND', '论文尚无解析结果')
  }
  return structuredClone(extraction)
}

/** 创建 Suggestion 服务；Mock/API 共享 v05 DTO、请求转换和页面适配器。 */
export function createSuggestionService(
  initialPage: SuggestionPageDto = suggestionPageDtoMock,
  initialExtractions: Record<string, ExtractionDto> = extractionDtoMocks,
): SuggestionService {
  let pageDto = structuredClone(initialPage)
  let latestExtractions = structuredClone(initialExtractions)

  function viewPage(source = pageDto): SuggestionPage {
    return toSuggestionPageView(source, latestExtractions)
  }

  function findSuggestion(id: string): Suggestion {
    const suggestion = viewPage().items.find((item) => item.id === id)
    if (!suggestion) {
      throw apiError(404, 'SUGGESTION_NOT_FOUND', '建议不存在')
    }
    return suggestion
  }

  function updateDto(updated: SuggestionDto): Suggestion {
    const index = pageDto.items.findIndex((item) => item.id === updated.id)
    if (index >= 0) pageDto.items[index] = structuredClone(updated)
    return findSuggestion(updated.id)
  }

  function assertReviewable(suggestion: Suggestion) {
    if (suggestion.status === 'superseded' || (isResolve(suggestion) && !suggestion.canReview)) {
      throw apiError(409, 'SUGGESTION_SUPERSEDED', '该建议绑定的解析结果已经失效', {
        suggestionId: suggestion.id,
        currentStatus: suggestion.status === 'superseded' ? 'superseded' : 'pending',
      })
    }
    if (suggestion.status !== 'pending') {
      throw apiError(409, 'SUGGESTION_ALREADY_REVIEWED', '该建议已经完成审核', {
        suggestionId: suggestion.id,
        currentStatus: suggestion.status,
        reviewedAt: suggestion.reviewedAt,
      })
    }
  }

  function mockAccept(
    suggestion: Suggestion,
    request: AcceptSuggestionRequestDto,
  ): SuggestionDto {
    const reviewedAt = '2026-08-29T10:30:00Z'
    let executionResult: SuggestionDto['executionResult']
    if (request.resolution) {
      executionResult = {
        type: 'resolveMatch',
        resolvedTargets: request.resolution.selectedTargets.map((target, index) => {
          const candidate = suggestion.candidates.find((item) => item.id === target.candidateId)
          if (!candidate) throw apiError(400, 'INVALID_RESOLUTION_SELECTIONS', '实体消歧包含无效候选')
          return {
            candidateId: candidate.id,
            nodeId: candidate.nodeId ?? `mock-node-${candidate.id}`,
            label: target.labelOverride ?? candidate.label,
            created: candidate.kind === 'new',
            relationId: `mock-relation-${suggestion.id}-${index + 1}`,
          }
        }),
      }
    } else if (suggestion.operation === 'addFinding') {
      executionResult = { type: 'addFinding', nodeId: `mock-finding-${suggestion.id}`, relationId: `mock-relation-${suggestion.id}` }
    } else {
      executionResult = { type: 'addRelation', relationId: `mock-relation-${suggestion.id}` }
    }

    const dto = pageDto.items.find((item) => item.id === suggestion.id)
    if (!dto) throw apiError(404, 'SUGGESTION_NOT_FOUND', '建议不存在')
    return {
      ...structuredClone(dto),
      status: 'accepted',
      executionResult,
      reviewedAt,
      supersededAt: null,
      reviewComment: request.comment,
      updatedAt: reviewedAt,
    }
  }

  function mockReject(
    suggestion: Suggestion,
    request: RejectSuggestionRequestDto,
  ): SuggestionDto {
    const reviewedAt = '2026-08-29T10:32:00Z'
    const dto = pageDto.items.find((item) => item.id === suggestion.id)
    if (!dto) throw apiError(404, 'SUGGESTION_NOT_FOUND', '建议不存在')
    return {
      ...structuredClone(dto),
      status: 'rejected',
      executionResult: null,
      reviewedAt,
      supersededAt: null,
      reviewComment: request.reason,
      updatedAt: reviewedAt,
    }
  }

  function recordStatusChange(previous: SuggestionStatus, next: SuggestionStatus) {
    pageDto.statusCounts[previous] -= 1
    pageDto.statusCounts[next] += 1
  }

  const service: SuggestionService = {
    prime(nextPage, nextExtractions) {
      pageDto = structuredClone(nextPage)
      latestExtractions = structuredClone(nextExtractions)
    },

    async listSuggestions(status) {
      if (getDataMode() === 'mock') {
        return viewPage(scopePage(pageDto, status))
      }

      const query = new URLSearchParams({ page: '1', pageSize: '20' })
      if (status) query.set('status', status)
      const dto = await requestJson<SuggestionPageDto>(`/api/v1/suggestions?${query.toString()}`)
      const paperIds = [...new Set(dto.items.map((item) => item.paperId))]
      const extractions = await Promise.all(paperIds.map(async (paperId) => [
        paperId,
        await loadLatestExtraction(paperId),
      ] as const))
      pageDto = structuredClone(dto)
      latestExtractions = Object.fromEntries(extractions)
      return viewPage()
    },

    async listAllSuggestions() {
      return (await service.listSuggestions()).items
    },

    async acceptSuggestion(id, input = {}) {
      const suggestion = findSuggestion(id)
      assertReviewable(suggestion)
      const selectedIds = input.selectedIds ?? getDefaultCandidateIds(suggestion)
      let request: AcceptSuggestionRequestDto
      try {
        request = buildAcceptSuggestionRequest(
          suggestion,
          selectedIds,
          input.labelOverrides ?? {},
          input.comment ?? null,
        )
      } catch (error) {
        throw apiError(400, 'INVALID_RESOLUTION_SELECTIONS', error instanceof Error ? error.message : '无效候选')
      }

      const updated = getDataMode() === 'api'
        ? await requestJson<SuggestionDto>(
            `/api/v1/suggestions/${encodeURIComponent(id)}/accept`,
            postJsonInit(request),
          )
        : mockAccept(suggestion, request)
      recordStatusChange(suggestion.status, updated.status)
      return updateDto(updated)
    },

    async rejectSuggestion(id, reason = null) {
      const suggestion = findSuggestion(id)
      assertReviewable(suggestion)
      const request = buildRejectSuggestionRequest(reason)
      const updated = getDataMode() === 'api'
        ? await requestJson<SuggestionDto>(
            `/api/v1/suggestions/${encodeURIComponent(id)}/reject`,
            postJsonInit(request),
          )
        : mockReject(suggestion, request)
      recordStatusChange(suggestion.status, updated.status)
      return updateDto(updated)
    },

    async reviewSuggestions(input) {
      const skipped: string[] = []
      const jobs: Array<{ id: string; promise: Promise<Suggestion> }> = []

      input.ids.forEach((id) => {
        let suggestion: Suggestion | null = null
        try {
          suggestion = findSuggestion(id)
        } catch {
          // Missing items must still enter allSettled and surface as failures.
        }
        if (input.status === 'accepted' && suggestion && isResolve(suggestion)) {
          const defaultIds = getDefaultCandidateIds(suggestion)
          if (defaultIds.length === 0) {
            skipped.push(id)
            return
          }
        }

        jobs.push({
          id,
          promise: Promise.resolve().then(() => input.status === 'accepted'
            ? service.acceptSuggestion(id, {
                selectedIds: suggestion && isResolve(suggestion)
                  ? getDefaultCandidateIds(suggestion)
                  : [],
                comment: input.comment ?? null,
              })
            : service.rejectSuggestion(id, input.comment ?? null)),
        })
      })

      const settled = await Promise.allSettled(jobs.map((job) => job.promise))
      const updated: Suggestion[] = []
      const failures: BatchReviewFailure[] = []
      settled.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          updated.push(result.value)
          return
        }
        failures.push({
          id: jobs[index].id,
          error: result.reason instanceof ApiClientError
            ? result.reason
            : apiError(500, 'SUGGESTION_REVIEW_FAILED', '审核失败'),
        })
      })
      return { updated, failures, skipped }
    },
  }

  return service
}

/** 创建有状态 Mock 服务，仍走与 API 模式相同的 DTO 适配和请求转换。 */
export function createMockSuggestionService(
  initialPage: SuggestionPageDto = suggestionPageDtoMock,
  initialExtractions: Record<string, ExtractionDto> = extractionDtoMocks,
): SuggestionService {
  return createSuggestionService(initialPage, initialExtractions)
}

export const suggestionService = createSuggestionService()
