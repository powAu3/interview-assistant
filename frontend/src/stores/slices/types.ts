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
  think_enabled_params?: Record<string, unknown>
  think_disabled_params?: Record<string, unknown>
}

export interface ModelFullInfo {
  name: string
  api_base_url: string
  api_key: string
  model: string
  supports_think: boolean
  supports_vision: boolean
  enabled: boolean
  think_enabled_params?: Record<string, unknown>
  think_disabled_params?: Record<string, unknown>
  has_key: boolean
}

export interface AppConfig {
  models: ModelInfo[]
  active_model: number
  model_name: string
  temperature: number
  max_tokens: number
  think_mode: boolean
  think_effort: string
  stt_provider: string
  whisper_model: string
  whisper_language: string
  whisper_preload: boolean
  doubao_stt_app_id: string
  doubao_stt_access_token: string
  doubao_stt_api_key: string
  doubao_stt_resource_id: string
  doubao_stt_boosting_table_id: string
  generic_stt_api_base_url: string
  generic_stt_api_key: string
  generic_stt_model: string
  generic_stt_custom_headers: string
  candidate_asr_enabled?: boolean
  candidate_stt_provider?: string
  candidate_whisper_model?: string
  candidate_whisper_language?: string
  candidate_remote_stt_enabled?: boolean
  candidate_context_enabled?: boolean
  candidate_context_wait_ms?: number
  candidate_context_max_chars?: number
  candidate_context_min_chars?: number
  candidate_streaming_asr_enabled?: boolean
  candidate_streaming_asr_interval_ms?: number
  candidate_mic_compatibility_mode?: boolean
  position: string
  language: string
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
  /** 主链路单段最长语音（秒），避免连续讲话攒成超长 ASR 请求 */
  assist_vad_max_speech_sec?: number
  /** 主链路单段最短语音（秒），短于该值的片段不送 ASR */
  assist_vad_min_speech_sec?: number
  /** 高 churn 场景下自动切短答 */
  assist_high_churn_short_answer?: boolean
  /** 实时语音问答默认输出 token 上限 */
  assist_realtime_max_tokens?: number
  /** 高 churn 短答模式输出 token 上限 */
  assist_realtime_high_churn_max_tokens?: number
  /** 停止录音时等待答案 worker 收尾的最长秒数 */
  assist_stop_answer_wait_sec?: number
  /** 停止录音时等待面试官 ASR segment worker 清空队列的最长秒数 */
  assist_interviewer_asr_drain_timeout_sec?: number
  /** 电脑截图区域：full | left_half | right_half | top_half | bottom_half */
  screen_capture_region?: string
  /** 截图送入识图模型前的最长边限制；0=不缩放 */
  screen_capture_max_long_edge?: number
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
  // --- Review (面试复盘) ---
  /** 是否启用面试复盘功能（默认关闭）*/
  review_enabled?: boolean
  /** 复盘分析使用的模型索引 */
  review_model_index?: number
}

export type QAStatus = 'streaming' | 'done' | 'cancelled' | 'error'

export interface QAPair {
  id: string
  question: string
  answer: string
  thinkContent: string
  isThinking: boolean
  timestamp: number
  questionSource?: string
  modelLabel?: string
  firstTokenMs?: number
  totalMs?: number
  visionVerify?: { verdict: 'PASS' | 'FAIL' | 'UNKNOWN'; reason: string }
  status?: QAStatus
  errorMessage?: string
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
