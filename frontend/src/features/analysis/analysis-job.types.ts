export type AnalysisJobStatus =
  | 'queued'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled'

export type AnalysisStage =
  | 'queued'
  | 'preparing'
  | 'parsing'
  | 'analyzing'
  | 'storing'
  | 'completed'
  | 'failed'
  | 'cancelled'

export type AnalysisJobError = {
  code: string
  message: string
  details: Record<string, unknown> | null
}

export type AnalysisJob = {
  id: string
  paperId: string
  paperTitle?: string
  paperJournal?: string | null
  paperYear?: number | null
  status: AnalysisJobStatus
  progress: number
  stage: AnalysisStage
  resultMode?: 'preserve' | 'replace'
  error: AnalysisJobError | null
  createdAt: string
  startedAt: string | null
  completedAt: string | null
}
