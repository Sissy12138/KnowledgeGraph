import type { Suggestion, SuggestionOperation } from './suggestion.types'

export const suggestionOperations: SuggestionOperation[] = [
  'resolveConceptMatch',
  'resolveMethodMatch',
  'addFinding',
  'addRelation',
]

const operationLabels: Record<SuggestionOperation, string> = {
  resolveConceptMatch: '概念匹配',
  resolveMethodMatch: '方法匹配',
  addFinding: '发现新增',
  addRelation: '关系新增',
}

export interface SuggestionCategoryGroup {
  operation: SuggestionOperation
  label: string
  items: Suggestion[]
}

export interface SuggestionPaperGroup {
  paperId: string
  paperTitle: string
  total: number
  categories: SuggestionCategoryGroup[]
}

/** 将建议按论文和 v05 operation 分组，不依赖已删除的 action。 */
export function groupSuggestionsByPaper(
  suggestions: Suggestion[],
  papers: Array<{ id: string; title: string }>,
): SuggestionPaperGroup[] {
  const titleByPaperId = new Map(papers.map((paper) => [paper.id, paper.title]))
  const suggestionsByPaperId = new Map<string, Suggestion[]>()

  suggestions.forEach((suggestion) => {
    const paperSuggestions = suggestionsByPaperId.get(suggestion.paperId) ?? []
    paperSuggestions.push(suggestion)
    suggestionsByPaperId.set(suggestion.paperId, paperSuggestions)
  })

  return Array.from(suggestionsByPaperId, ([paperId, items]) => ({
    paperId,
    paperTitle: titleByPaperId.get(paperId) ?? `未知论文（${paperId}）`,
    total: items.length,
    categories: suggestionOperations.map((operation) => ({
      operation,
      label: operationLabels[operation],
      items: items.filter((item) => item.operation === operation),
    })),
  }))
}
