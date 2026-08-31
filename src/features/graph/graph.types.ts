export type GraphView = 'concept' | 'method' | 'author' | 'paper'
export type GraphScenario = 'success' | 'empty' | 'error'
export type GraphNodeType = 'paper' | 'author' | 'concept' | 'method' | 'finding'

export type Evidence = {
  id: string
  paperId: string
  section: string | null
  text: string
}

export type JournalInfo = {
  name: string
  impactFactor: number | null
  impactFactorYear: number | null
  jcrQuartile: 'Q1' | 'Q2' | 'Q3' | 'Q4' | null
}

export type GraphPaperSummary = {
  id: string
  title: string
  authorNames: string[]
  year: number | null
  journal: JournalInfo | null
}

export type GraphNode = {
  id: string
  nodeType: GraphNodeType
  label: string
  description: string | null
  sourcePaperIds: string[]
  metrics: {
    paperCount?: number
    connectionCount?: number
    totalImpactFactor?: number
  }
}

export type GraphEdge = {
  id: string
  sourceId: string
  targetId: string
  relationType:
    | 'broaderThan'
    | 'relatedTo'
    | 'uses'
    | 'coAuthor'
    | 'cites'
    | 'conceptAuthor'
    | 'conceptMethod'
    | 'authorConcept'
    | 'authorMethod'
    | 'paperConcept'
  label: string
  directed: boolean
  weight: number | null
  evidenceIds: string[]
  sourcePaperIds: string[]
}

type BaseNodeDetail = {
  nodeId: string
  nodeType: GraphNodeType
}

export type ConceptNodeDetail = BaseNodeDetail & {
  nodeType: 'concept'
  aliases: string[]
  broaderConceptIds: string[]
  narrowerConceptIds: string[]
  relatedConceptIds: string[]
  paperIds: string[]
}

export type MethodNodeDetail = BaseNodeDetail & {
  nodeType: 'method'
  methodType: string
  paperIds: string[]
}

export type AuthorNodeDetail = BaseNodeDetail & {
  nodeType: 'author'
  orcid: string | null
  affiliations: string[]
  paperIds: string[]
}

export type PaperNodeDetail = BaseNodeDetail & {
  nodeType: 'paper'
  paperId: string
  conceptIds: string[]
  methodIds: string[]
  findingSummaries: string[]
}

export type GraphNodeDetail =
  | ConceptNodeDetail
  | MethodNodeDetail
  | AuthorNodeDetail
  | PaperNodeDetail

export type GraphDataset = {
  view: GraphView
  nodes: GraphNode[]
  edges: GraphEdge[]
  contextOverlay: {
    nodes: GraphNode[]
    edges: GraphEdge[]
  }
  evidence: Evidence[]
  papers: Record<string, GraphPaperSummary>
  relatedNodeLabels: Record<string, string>
  nodeDetails: Record<string, GraphNodeDetail>
}

export type GraphSelection =
  | { kind: 'node'; id: string }
  | { kind: 'edge'; id: string }
  | null
