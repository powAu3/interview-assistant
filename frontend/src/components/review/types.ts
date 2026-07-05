export interface ReviewSession {
  id: number
  status: 'recording' | 'recorded' | 'analyzing' | 'completed' | 'partial_capture' | 'analysis_failed'
  started_at: number
  ended_at: number | null
  source: string
  title?: string | null
  company?: string | null
  role?: string | null
  auto_sync_eligible?: boolean
  application_id?: number | null
  application?: {
    id: number
    company: string
    position: string
    city: string
    stage: string
    applied_at?: number | null
    next_followup_at?: number | null
    updated_at?: number | null
  } | null
  jd_snapshot?: string | null
  resume_snapshot?: string | null
  interviewer_capture_enabled: boolean
  candidate_capture_enabled: boolean
  turn_count: number
  avg_score: number | null
  summary_markdown?: string | null
  strong_points?: string[] | null
  weak_points?: string[] | null
  behavior_traits?: string[] | null
  domain_summary?: Record<string, unknown> | null
  created_at: number
  updated_at: number
}

export interface ReviewTurn {
  id: number
  session_id: number
  qa_id: string
  seq: number
  question_text: string
  candidate_answer_text: string
  original_candidate_answer_text?: string | null
  reference_answer_text?: string | null
  code_text?: string | null
  duration_ms: number
  is_partial: boolean
  analysis_status: 'pending' | 'analyzing' | 'completed' | 'failed'
  strengths?: string[] | null
  risks?: string[] | null
  evidence?: Record<string, unknown> | null
  scorecard?: Record<string, number> | null
  created_at: number
  updated_at: number
}

export interface ReviewSessionDetail extends ReviewSession {
  turns: ReviewTurn[]
}

export interface ReviewSessionsResponse {
  total: number
  page: number
  page_size: number
  items: ReviewSession[]
}
