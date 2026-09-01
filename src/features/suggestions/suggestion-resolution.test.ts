import { describe, expect, it } from 'vitest'
import type { Suggestion } from './suggestion.types'
import {
  buildAcceptSuggestionRequest,
  buildRejectSuggestionRequest,
  getDefaultCandidateIds,
  toggleCandidateSelection,
} from './suggestion-resolution'

function makeSuggestion(overrides: Partial<Suggestion> = {}): Suggestion {
  return {
    id: 'suggestion-1', paperId: 'paper-1', paperTitle: 'Paper A', extractionId: 'extraction-1',
    operation: 'resolveConceptMatch', status: 'pending', title: 'Resolve concept', reason: 'Ambiguous concept', confidence: 0.61,
    evidence: [],
    candidates: [
      { id: 'existing-1', kind: 'existing', nodeId: 'concept-1', label: 'Existing', recommendationScore: 0.21 },
      { id: 'existing-2', kind: 'existing', nodeId: 'concept-2', label: 'Existing 2', recommendationScore: null },
      { id: 'new-1', kind: 'new', nodeId: null, label: 'New label', recommendationScore: 0.1 },
      { id: 'new-2', kind: 'new', nodeId: null, label: 'Another new', recommendationScore: null },
    ],
    candidateState: 'current', canReview: true,
    proposedChange: { type: 'resolveConceptMatch', extractedConceptId: 'concept-extracted-1', candidateIds: ['existing-1', 'existing-2', 'new-1', 'new-2'], defaultCandidateId: 'new-1', maxSelections: 3 },
    executionResult: null, reviewedAt: null, supersededAt: null, reviewComment: null,
    createdAt: '2026-08-26T09:00:00Z', updatedAt: '2026-08-26T09:00:00Z',
    ...overrides,
  }
}

describe('suggestion resolution rules', () => {
  it('uses only the backend default candidate regardless of recommendation score', () => {
    expect(getDefaultCandidateIds(makeSuggestion())).toEqual(['new-1'])
    expect(getDefaultCandidateIds(makeSuggestion({
      proposedChange: { type: 'resolveConceptMatch', extractedConceptId: 'concept-extracted-1', candidateIds: ['existing-1'], defaultCandidateId: null, maxSelections: 3 },
    }))).toEqual([])
  })

  it('builds the v05 multi-match request without silently remapping New', () => {
    expect(buildAcceptSuggestionRequest(makeSuggestion(), ['existing-1', 'new-1', 'existing-2'], {
      'existing-1': 'must be ignored', 'new-1': '  修订名称  ',
    }, '  ok  ')).toEqual({
      comment: 'ok',
      resolution: { selectedTargets: [
        { candidateId: 'existing-1', labelOverride: null },
        { candidateId: 'new-1', labelOverride: '修订名称' },
        { candidateId: 'existing-2', labelOverride: null },
      ] },
    })
  })

  it('uses null resolution for non-resolve operations and allows an empty rejection reason', () => {
    const suggestion = makeSuggestion({
      operation: 'addFinding',
      proposedChange: { type: 'addFinding', extractedFindingId: 'finding-1', statement: 'Finding' },
      candidates: [], candidateState: 'notApplicable',
    })
    expect(buildAcceptSuggestionRequest(suggestion, [], {}, '   ')).toEqual({ comment: null, resolution: null })
    expect(buildRejectSuggestionRequest('   ')).toEqual({ reason: null })
  })

  it('rejects invalid resolve target counts and more than one New target', () => {
    expect(() => buildAcceptSuggestionRequest(makeSuggestion(), [], {}, null)).toThrow('实体消歧必须选择一至三个候选')
    expect(() => buildAcceptSuggestionRequest(makeSuggestion(), ['new-1', 'new-2'], {}, null)).toThrow('实体消歧最多只能选择一个 New 候选')
    expect(() => buildAcceptSuggestionRequest(makeSuggestion(), ['existing-1', 'existing-1'], {}, null)).toThrow('实体消歧候选不得重复')
  })

  it('allows deselection but refuses a fourth selected candidate', () => {
    expect(toggleCandidateSelection(['a', 'b', 'c'], 'd')).toEqual(['a', 'b', 'c'])
    expect(toggleCandidateSelection(['a', 'b', 'c'], 'b')).toEqual(['a', 'c'])
  })
})
