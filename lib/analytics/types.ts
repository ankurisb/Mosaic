export type AnalysisCategory =
  | 'spc'
  | 'time_series'
  | 'reliability'
  | 'quality'
  | 'correlation'
  | 'oee'
  | 'energy'
  | 'hypothesis'

export interface AnalysisDefinition {
  name: string
  category: AnalysisCategory
  title: string
  description: string
  when_to_use: string
  required_inputs: string[]
  optional_inputs?: string[]
  output_summary: string
  example_question: string
}

export interface AnalysisRequest {
  analysis_type: string
  data: number[] | Record<string, unknown>[]
  params?: Record<string, unknown>
}

export interface AnalysisResult {
  analysis_type: string
  ok: boolean
  error?: string
  result: Record<string, unknown>
  interpretation?: string
}
