import type {
  Evidence,
  Extraction as ExtractionDto,
  ProposedChange,
  Suggestion as SuggestionDto,
  SuggestionExecutionResult,
  SuggestionOperation,
  SuggestionPage as SuggestionPageDto,
  SuggestionStatus,
} from '../../contracts/v05.types'
import { toSuggestionPageView } from './suggestion.adapter'

const timestamps = {
  createdAt: '2026-08-26T09:00:00Z',
  updatedAt: '2026-08-26T09:00:00Z',
}

function suggestion(
  id: string,
  paperId: string,
  extractionId: string,
  operation: SuggestionOperation,
  status: SuggestionStatus,
  title: string,
  evidenceIds: string[],
  proposedChange: ProposedChange,
  options: {
    confidence?: number | null
    reviewComment?: string | null
    executionResult?: SuggestionExecutionResult | null
    reviewedAt?: string | null
    supersededAt?: string | null
  } = {},
): SuggestionDto {
  return {
    id,
    paperId,
    extractionId,
    operation,
    status,
    title,
    reason: `论文证据支持“${title}”的审核建议。`,
    confidence: options.confidence ?? null,
    evidenceIds,
    proposedChange,
    executionResult: options.executionResult ?? null,
    reviewedAt: options.reviewedAt ?? null,
    supersededAt: options.supersededAt ?? null,
    reviewComment: options.reviewComment ?? null,
    ...timestamps,
  }
}

const evidence: Evidence[] = [
  { id: 'evidence-001', paperId: 'paper-001', section: 'Introduction', text: '反转学习将知识传授移至课前，并把课堂时间用于讨论与问题解决。' },
  { id: 'evidence-002', paperId: 'paper-001', section: 'Methods', text: '参与者完成包含四十次试次的行为任务，正确率和反应时间被同步记录。' },
  { id: 'evidence-005', paperId: 'paper-003', section: 'Results', text: '与对照组相比，实验组的测验正确率提高了 12.4%。' },
  { id: 'evidence-006', paperId: 'paper-003', section: 'Methods', text: '神经群体活动被投影到低维状态空间，以比较不同记忆阶段的动力学轨迹。' },
  { id: 'evidence-accepted-001', paperId: 'paper-001', section: 'Results', text: '规则切换试次的平均反应时间显著长于规则重复试次。' },
  { id: 'evidence-rejected-001', paperId: 'paper-001', section: 'Discussion', text: '前额叶活动与正确率呈弱相关，但该结果未通过多重比较校正。' },
  { id: 'evidence-superseded-001', paperId: 'paper-001', section: null, text: '旧解析结果中的候选已经失效。' },
]

/** 模拟 GET /api/v1/suggestions 返回的完整 v05 当前页 DTO。 */
export const suggestionPageDtoMock: SuggestionPageDto = {
  items: [
    suggestion(
      'suggestion-001', 'paper-001', 'extraction-001', 'resolveConceptMatch', 'pending', '新增概念：反转学习', ['evidence-001'],
      { type: 'resolveConceptMatch', extractedConceptId: 'extracted-concept-001', candidateIds: ['concept-existing-flipped-classroom', 'concept-existing-blended-learning', 'concept-new-inverted-learning', 'concept-existing-classroom-teaching'], defaultCandidateId: 'concept-existing-flipped-classroom', maxSelections: 3 },
      { confidence: 0.91 },
    ),
    suggestion(
      'suggestion-002', 'paper-001', 'extraction-001', 'resolveMethodMatch', 'pending', '新增方法：行为任务', ['evidence-002'],
      { type: 'resolveMethodMatch', extractedMethodId: 'extracted-method-001', candidateIds: ['method-existing-behavioral-task', 'method-existing-choice-task', 'method-new-forty-trial-task'], defaultCandidateId: 'method-existing-behavioral-task', maxSelections: 3 },
      { confidence: 0.84 },
    ),
    suggestion(
      'suggestion-005', 'paper-003', 'extraction-003', 'addFinding', 'pending', '新增发现：学习成绩提升', ['evidence-005'],
      { type: 'addFinding', extractedFindingId: 'extracted-finding-005', statement: '反转学习组的测验正确率高于对照组' },
      { confidence: 0.88 },
    ),
    suggestion(
      'suggestion-006', 'paper-003', 'extraction-003', 'resolveMethodMatch', 'pending', '新增方法：状态空间分析', ['evidence-006'],
      { type: 'resolveMethodMatch', extractedMethodId: 'extracted-method-006', candidateIds: ['method-existing-state-space', 'method-new-neural-trajectory'], defaultCandidateId: 'method-existing-state-space', maxSelections: 3 },
      { confidence: 0.82 },
    ),
    suggestion(
      'suggestion-accepted-001', 'paper-001', 'extraction-001', 'addFinding', 'accepted', '新增发现：规则切换后反应变慢', ['evidence-accepted-001'],
      { type: 'addFinding', extractedFindingId: 'extracted-finding-accepted', statement: '规则切换会增加反应时间' },
      { confidence: 0.9, reviewedAt: '2026-08-28T09:20:00Z', executionResult: { type: 'addFinding', nodeId: 'finding-switch-cost', relationId: 'relation-reports-switch-cost' } },
    ),
    suggestion(
      'suggestion-rejected-001', 'paper-001', 'extraction-001', 'addRelation', 'rejected', '新增关系：前额叶活动与正确率相关', ['evidence-rejected-001'],
      { type: 'addRelation', sourceId: 'concept-prefrontal-activity', sourceType: 'concept', targetId: 'concept-accuracy', targetType: 'concept', relationType: 'relatedTo' },
      { confidence: 0.61, reviewedAt: '2026-08-28T09:30:00Z', reviewComment: '证据不足，相关结果未通过多重比较校正' },
    ),
    suggestion(
      'suggestion-superseded-001', 'paper-001', 'extraction-old', 'resolveConceptMatch', 'superseded', '旧概念匹配', ['evidence-superseded-001'],
      { type: 'resolveConceptMatch', extractedConceptId: 'extracted-concept-old', candidateIds: ['candidate-old'], defaultCandidateId: 'candidate-old', maxSelections: 3 },
      { supersededAt: '2026-08-29T08:00:00Z' },
    ),
  ],
  page: 1,
  pageSize: 20,
  total: 7,
  evidence,
  papers: [
    { id: 'paper-001', title: '反转学习中的认知灵活性与前额叶活动' },
    { id: 'paper-003', title: '适应性决策的脑电标记' },
  ],
  statusCounts: { pending: 4, accepted: 1, rejected: 1, superseded: 1 },
}

/** 模拟公开 latest Extraction 端点；候选详情只存在于此池。 */
export const extractionDtoMocks: Record<string, ExtractionDto> = {
  'paper-001': {
    id: 'extraction-001', paperId: 'paper-001', analysisJobId: 'job-001', isLatest: true,
    researchOverview: { researchTopics: ['反转学习'], researchQuestion: null, sample: null, methods: '行为任务', mainResults: null },
    concepts: [{
      id: 'extracted-concept-001', paperId: 'paper-001', rawText: '反转学习', normalizedLabel: '反转学习', matchStatus: 'uncertain', matchedConceptIds: [], extractionConfidence: 0.91, evidenceIds: ['evidence-001'],
      candidates: [
        { id: 'concept-existing-flipped-classroom', kind: 'existing', nodeId: 'concept-flipped-classroom', label: '翻转课堂', recommendationScore: 0.86 },
        { id: 'concept-existing-blended-learning', kind: 'existing', nodeId: 'concept-blended-learning', label: '混合学习', recommendationScore: 0.63 },
        { id: 'concept-new-inverted-learning', kind: 'new', nodeId: null, label: '反转学习', recommendationScore: 0.72 },
        { id: 'concept-existing-classroom-teaching', kind: 'existing', nodeId: 'concept-classroom-teaching', label: '课堂教学', recommendationScore: 0.41 },
      ],
    }],
    methods: [{
      id: 'extracted-method-001', paperId: 'paper-001', rawText: '行为任务', normalizedLabel: '行为任务', methodType: 'behavioralTask', description: null, matchStatus: 'uncertain', matchedMethodIds: [], extractionConfidence: 0.84, evidenceIds: ['evidence-002'],
      candidates: [
        { id: 'method-existing-behavioral-task', kind: 'existing', nodeId: 'method-behavioral-task', label: '行为任务', recommendationScore: 0.84 },
        { id: 'method-existing-choice-task', kind: 'existing', nodeId: 'method-choice-task', label: '选择反应任务', recommendationScore: 0.67 },
        { id: 'method-new-forty-trial-task', kind: 'new', nodeId: null, label: '四十试次行为任务', recommendationScore: 0.76 },
      ],
    }],
    findings: [], evidence: evidence.filter((item) => item.paperId === 'paper-001'), createdAt: '2026-08-26T08:00:00Z',
  },
  'paper-003': {
    id: 'extraction-003', paperId: 'paper-003', analysisJobId: 'job-003', isLatest: true,
    researchOverview: { researchTopics: ['学习成绩'], researchQuestion: null, sample: null, methods: '状态空间分析', mainResults: null },
    concepts: [],
    methods: [{
      id: 'extracted-method-006', paperId: 'paper-003', rawText: '状态空间分析', normalizedLabel: '状态空间分析', methodType: 'computationalModel', description: null, matchStatus: 'uncertain', matchedMethodIds: [], extractionConfidence: 0.82, evidenceIds: ['evidence-006'],
      candidates: [
        { id: 'method-existing-state-space', kind: 'existing', nodeId: 'method-state-space-analysis', label: '状态空间分析', recommendationScore: 0.82 },
        { id: 'method-new-neural-trajectory', kind: 'new', nodeId: null, label: '神经轨迹分析', recommendationScore: 0.71 },
      ],
    }],
    findings: [{ id: 'extracted-finding-005', paperId: 'paper-003', statement: '反转学习组的测验正确率高于对照组', confidence: 0.88, evidenceIds: ['evidence-005'] }],
    evidence: evidence.filter((item) => item.paperId === 'paper-003'), createdAt: '2026-08-26T08:00:00Z',
  },
}

/** 兼容尚待 Task 4 迁移的页面测试；来源仍是同一 v05 DTO 与适配器。 */
export const suggestionMocks = toSuggestionPageView(
  structuredClone(suggestionPageDtoMock),
  structuredClone(extractionDtoMocks),
).items
