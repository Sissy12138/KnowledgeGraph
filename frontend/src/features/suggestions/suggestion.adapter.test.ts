import { describe, expect, it } from 'vitest'
import type { Extraction as ExtractionDto, SuggestionPage as SuggestionPageDto } from '../../contracts/v05.types'
import { toSuggestionPageView } from './suggestion.adapter'

const suggestionPageDto: SuggestionPageDto = {
  items: [
    {
      id: 'suggestion-1', paperId: 'paper-1', extractionId: 'extraction-1', operation: 'resolveConceptMatch', status: 'pending', title: 'Resolve', reason: 'Why', confidence: 0.42,
      evidenceIds: ['ev-1'], proposedChange: { type: 'resolveConceptMatch', extractedConceptId: 'concept-1', candidateIds: ['candidate-1'], defaultCandidateId: 'candidate-1', maxSelections: 3 },
      executionResult: null, reviewedAt: null, supersededAt: null, reviewComment: null, createdAt: '2026-08-26T09:00:00Z', updatedAt: '2026-08-26T09:00:00Z',
    },
    {
      id: 'suggestion-superseded', paperId: 'paper-1', extractionId: 'extraction-old', operation: 'resolveMethodMatch', status: 'superseded', title: 'Old', reason: 'Old', confidence: null,
      evidenceIds: ['ev-1'], proposedChange: { type: 'resolveMethodMatch', extractedMethodId: 'method-old', candidateIds: ['old-candidate'], defaultCandidateId: 'old-candidate', maxSelections: 3 },
      executionResult: null, reviewedAt: null, supersededAt: '2026-08-27T09:00:00Z', reviewComment: null, createdAt: '2026-08-25T09:00:00Z', updatedAt: '2026-08-27T09:00:00Z',
    },
    {
      id: 'suggestion-accepted', paperId: 'paper-1', extractionId: 'extraction-old', operation: 'resolveConceptMatch', status: 'accepted', title: 'Accepted', reason: 'Accepted', confidence: 0.8,
      evidenceIds: ['ev-1'], proposedChange: { type: 'resolveConceptMatch', extractedConceptId: 'concept-old', candidateIds: ['old-candidate'], defaultCandidateId: 'old-candidate', maxSelections: 3 },
      executionResult: { type: 'resolveMatch', resolvedTargets: [{ candidateId: 'old-candidate', nodeId: 'node-1', label: 'Final label', created: false, relationId: 'relation-1' }] },
      reviewedAt: '2026-08-26T10:00:00Z', supersededAt: null, reviewComment: null, createdAt: '2026-08-25T10:00:00Z', updatedAt: '2026-08-26T10:00:00Z',
    },
  ],
  page: 1, pageSize: 20, total: 3,
  evidence: [{ id: 'ev-1', paperId: 'paper-1', section: 'Results', text: 'Evidence text' }],
  papers: [{ id: 'paper-1', title: 'Paper A' }],
  statusCounts: { pending: 1, accepted: 1, rejected: 0, superseded: 1 },
}

const latestExtractionDto: ExtractionDto = {
  id: 'extraction-1', paperId: 'paper-1', analysisJobId: 'job-1', isLatest: true,
  researchOverview: { researchTopics: [], researchQuestion: null, sample: null, methods: null, mainResults: null },
  concepts: [{
    id: 'concept-1', paperId: 'paper-1', rawText: 'raw', normalizedLabel: 'Concept', matchStatus: 'uncertain', matchedConceptIds: [],
    candidates: [{ id: 'candidate-1', kind: 'existing', nodeId: 'node-1', label: 'Candidate', recommendationScore: 0.42 }],
    extractionConfidence: 0.5, evidenceIds: ['ev-1'],
  }],
  methods: [], findings: [], evidence: suggestionPageDto.evidence, createdAt: '2026-08-26T08:00:00Z',
}

describe('toSuggestionPageView', () => {
  it('joins page-scoped paper, evidence and current extraction candidate pools', () => {
    const page = toSuggestionPageView(suggestionPageDto, { 'paper-1': latestExtractionDto })
    expect(page.items[0].paperTitle).toBe('Paper A')
    expect(page.items[0].evidence.map((item) => item.id)).toEqual(['ev-1'])
    expect(page.items[0].candidates.map((item) => item.id)).toEqual(['candidate-1'])
    expect(page.items[0]).toMatchObject({ candidateState: 'current', canReview: true })
    expect(page.statusCounts.superseded).toBe(1)
  })

  it('blocks a pending review when the latest extraction no longer matches', () => {
    const page = toSuggestionPageView(suggestionPageDto, { 'paper-1': { ...latestExtractionDto, id: 'extraction-2' } })
    expect(page.items[0]).toMatchObject({ canReview: false, candidateState: 'staleExtraction', candidates: [] })
  })

  it('uses executionResult for reviewed history without inventing old candidates', () => {
    const page = toSuggestionPageView(suggestionPageDto, { 'paper-1': latestExtractionDto })
    expect(page.items[2].candidates).toEqual([])
    expect(page.items[2].candidateState).toBe('history')
    expect(page.items[2].executionResult).toEqual(suggestionPageDto.items[2].executionResult)
    expect(page.items[1]).toMatchObject({ candidateState: 'staleExtraction', canReview: false })
  })
})
