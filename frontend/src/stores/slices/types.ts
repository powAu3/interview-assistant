export type ToastLevel = 'info' | 'success' | 'warn' | 'error'

export interface ToastItem {
  id: string
  message: string
  level: ToastLevel
  ttlMs: number
}

export interface ModelInfo {
  name: string
  supports_think: boolean
  supports_vision: boolean
  enabled?: boolean
}

export interface ModelFullInfo {
  name: string
  api_base_url: string
  api_key: string
  model: string
  supports_think: boolean
  supports_vision: boolean
  enabled: boolean
  has_key: boolean
}

export interface AppConfig {
  models: ModelInfo[]
  active_model: number
  model_name: string
  temperature: number
  max_tokens: number
  think_mode: boolean
  stt_provider: string
  whisper_model: string
  whisper_language: string
  doubao_stt_app_id: string
  doubao_stt_access_token: string
  doubao_stt_resource_id: string
  doubao_stt_boosting_table_id: string
  generic_stt_api_base_url: string
  generic_stt_api_key: string
  generic_stt_model: string
  practice_tts_provider?: string
  edge_tts_available?: boolean
  edge_tts_status_detail?: string
  edge_tts_voice_female?: string
  edge_tts_voice_male?: string
  edge_tts_rate?: string
  edge_tts_pitch?: string
  volcengine_tts_appkey?: string
  volcengine_tts_token?: string
  practice_tts_speaker_female?: string
  practice_tts_speaker_male?: string
  position: string
  language: string
  /** 模拟练习候选人维度：campus_intern=校招/实习，social=社招 */
  practice_audience?: string
  auto_detect: boolean
  silence_threshold: number
  silence_duration: number
  api_key_set: boolean
  has_resume: boolean
  /** 当前生效简历在历史中的 id，无则 null */
  resume_active_history_id?: number | null
  /** 当前生效简历原始文件名 */
  resume_active_filename?: string | null
  max_parallel_answers?: number
  /** 流式答案区：距底部小于该像素则自动滚到底 */
  answer_autoscroll_bottom_px?: number
  /** 转写有效字符下限（去标点后计汉字/字母/数字），低于则不展示、不自动答题 */
  transcription_min_sig_chars?: number
  /** 多段 ASR 合并：上一段结束后静默超过该秒数再送出；0=每段立即发送 */
  assist_transcription_merge_gap_sec?: number
  /** 从首段 ASR 起最长等待（秒），超时强制送出 */
  assist_transcription_merge_max_sec?: number
  /** 高 churn 场景下自动切短答 */
  assist_high_churn_short_answer?: boolean
  /** 电脑截图区域：full | left_half | right_half | top_half | bottom_half */
  screen_capture_region?: string
  /** 多图截图判题：最后一次截图后等待多少秒再提交 */
  multi_screen_capture_idle_sec?: number
  /** 笔试模式：截屏后选择题直接出答案，编程题直接出代码 */
  written_exam_mode?: boolean
  /** 笔试模式下是否开启深度思考 */
  written_exam_think?: boolean
  // --- Knowledge Base (Beta) ---
  /** KB 总开关; 关闭后 pipeline 不查 KB,但 Drawer 里的手动测试仍可用 (force=True) */
  kb_enabled?: boolean
  /** 主流程检索 deadline (ms),超时直接返回空,不阻塞首字 */
  kb_deadline_ms?: number
  /** ASR 模式专用 deadline (ms),通常更紧 */
  kb_asr_deadline_ms?: number
  /** 命中数上限 */
  kb_top_k?: number
}

export interface QAPair {
  id: string
  question: string
  answer: string
  thinkContent: string
  isThinking: boolean
  timestamp: number
  questionSource?: string
  modelLabel?: string
  visionVerify?: { verdict: 'PASS' | 'FAIL' | 'UNKNOWN'; reason: string }
}

export type PracticeAnswerMode = 'voice' | 'code' | 'voice+code'

export interface PracticeContext {
  position: string
  language: string
  audience: string
  audience_label: string
  resume_text: string
  jd_text: string
  interviewer_style?: string
}

export interface PracticePhase {
  phase_id: string
  label: string
  category: string
  focus: string[]
  follow_up_budget: number
  answer_mode: PracticeAnswerMode
  question: string
  written_prompt?: string
  artifact_notes?: string[]
}

export interface PracticeBlueprint {
  opening_script: string
  phases: PracticePhase[]
}

export interface PracticeTurn {
  turn_id: string
  phase_id: string
  phase_label: string
  category: string
  answer_mode: PracticeAnswerMode
  question: string
  prompt_script: string
  stage_prompt?: string
  interviewer_signal?: string
  transition_line?: string
  written_prompt?: string
  artifact_notes?: string[]
  asked_at: number
  follow_up_of?: string | null
  transcript: string
  code_text: string
  duration_ms: number
  decision?: string
  decision_reason?: string
  evidence?: string[]
  strengths?: string[]
  risks?: string[]
  scorecard?: Record<string, number>
}

export interface PracticeSessionSnapshot {
  status: PracticeStatus
  context: PracticeContext | null
  blueprint: PracticeBlueprint | null
  current_phase_index: number
  current_turn: PracticeTurn | null
  turn_history: PracticeTurn[]
  interviewer_persona?: Record<string, string>
  report_markdown: string
  created_at: number
  finished_at?: number | null
}

export interface DeviceItem {
  id: number
  name: string
  channels: number
  is_loopback: boolean
  host_api: string
}

export interface PlatformInfo {
  platform: string
  needs_virtual_device: boolean
  instructions: string
}

export interface OptionsInfo {
  positions: string[]
  languages: string[]
  practice_audiences?: string[]
  practice_tts_providers?: string[]
  stt_providers?: string[]
  whisper_models: string[]
  screen_capture_regions?: string[]
}

export interface TokenUsage {
  prompt: number
  completion: number
  total: number
  byModel?: Record<string, { prompt: number; completion: number }>
}

export type SettingsDrawerTab = 'general' | 'config' | 'models'
export type ModelHealthStatus = 'checking' | 'ok' | 'error'
export type PracticeStatus =
  | 'idle'
  | 'preparing'
  | 'interviewer_speaking'
  | 'awaiting_answer'
  | 'thinking_next_turn'
  | 'debriefing'
  | 'finished'
