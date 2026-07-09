import { buildApiUrl } from './backendUrl'
import { getAuthToken } from './auth'

const BACKEND_UNREACHABLE_MESSAGE = '无法连接后端服务，请确认应用服务已启动后重试'

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function formatDetailValue(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) {
    const parts = value
      .map((item) => {
        if (!isRecord(item)) return formatDetailValue(item)
        const msg = formatDetailValue(item.msg ?? item.message ?? item.detail)
        const loc = Array.isArray(item.loc) ? item.loc.map(String).join('.') : null
        if (loc && msg) return `${loc}: ${msg}`
        return msg ?? formatDetailValue(item)
      })
      .filter(Boolean)
    return parts.length ? parts.join('; ') : null
  }
  if (isRecord(value)) {
    const direct = formatDetailValue(value.detail ?? value.message ?? value.error)
    if (direct) return direct
    try {
      return JSON.stringify(value)
    } catch {
      return null
    }
  }
  return null
}

async function parseResponseBody(res: Response): Promise<unknown> {
  const text = await res.text().catch(() => '')
  if (!text) return null
  const contentType = res.headers.get('content-type') ?? ''
  if (contentType.includes('json')) {
    try {
      return JSON.parse(text)
    } catch {
      return text
    }
  }
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

async function buildResponseErrorMessage(res: Response, fallback?: string): Promise<string> {
  const body = await parseResponseBody(res)
  const detail = isRecord(body) ? body.detail ?? body.message ?? body.error : body
  const detailText = formatDetailValue(detail) ?? fallback ?? res.statusText ?? '请求失败'
  return `请求失败 (${res.status}): ${detailText}`
}

async function fetchBackend(input: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init)
  } catch {
    throw new Error(BACKEND_UNREACHABLE_MESSAGE)
  }
}

export function getErrorMessage(error: unknown, fallback = '操作失败'): string {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'string' && error.trim()) return error
  if (isRecord(error)) return formatDetailValue(error) ?? fallback
  return fallback
}

function buildHeaders(extra?: HeadersInit): HeadersInit {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const token = getAuthToken()
  if (token) headers.Authorization = `Bearer ${token}`
  return { ...headers, ...(extra as Record<string, string> | undefined) }
}

async function request<T = any>(url: string, opts?: RequestInit): Promise<T> {
  const res = await fetchBackend(buildApiUrl(url), {
    ...opts,
    headers: buildHeaders(opts?.headers),
  })
  if (!res.ok) {
    throw new Error(await buildResponseErrorMessage(res))
  }
  if (res.status === 204) return undefined as T
  const body = await parseResponseBody(res)
  return body as T
}

export interface ResumeHistoryItem {
  id: number
  original_filename: string
  file_size: number
  created_at: number
  last_used_at: number
  parsed_ok: boolean
  preview: string
  parse_error: string | null
  is_active: boolean
}

/** GET /resume/history/:id 返回在列表项基础上增加 summary */
export type ResumeHistoryDetail = ResumeHistoryItem & {
  summary: string
  /** false 表示仅展示入库时的节选，点「选用」成功后会写入全文摘要 */
  summary_is_full?: boolean
}

// --- Knowledge Base ---
export type KBOrigin = 'text' | 'ocr' | 'vision' | 'mixed'

export interface KBHit {
  path: string
  section_path: string
  page?: number | null
  origin: KBOrigin
  score: number
  excerpt: string
}

export interface KBDoc {
  id: number
  path: string
  mtime: number
  size: number
  loader: string
  title: string | null
  status: 'ok' | 'failed' | 'pending'
  error: string | null
  chunk_count: number
}

export interface KBStatus {
  enabled: boolean
  trigger_modes: string[]
  top_k: number
  deadline_ms: number
  asr_deadline_ms: number
  total_docs: number
  total_chunks: number
  last_mtime: number
  deps: { docx: boolean; pdf: boolean; ocr: boolean; vision: boolean }
}

export interface KBRecentHit {
  ts: number
  query: string
  mode: string
  hit_count: number
  latency_ms: number
  timed_out?: boolean
  error?: string | null
  top_section_paths: string[]
}

export interface ResumeUploadResult {
  ok: boolean
  history_id: number
  parsed: boolean
  length?: number | null
  preview?: string | null
  parse_error?: string | null
}

export const api = {
  getConfig: () => request('/api/config'),
  updateConfig: (data: Record<string, any>) =>
    request('/api/config', { method: 'POST', body: JSON.stringify(data) }),
  modelsLayout: (data: {
    order?: number[]
    enabled?: boolean[]
    max_parallel_answers?: number
    active_model?: number
  }) => request('/api/config/models-layout', { method: 'POST', body: JSON.stringify(data) }),
  getModelsFull: () => request<{ models: import('@/stores/configStore').ModelFullInfo[] }>('/api/config/models-full'),
  getOptions: () => request('/api/options'),
  getDevices: () => request('/api/devices'),
  uploadResume: async (file: File): Promise<ResumeUploadResult> => {
    const fd = new FormData()
    fd.append('file', file)
    const token = getAuthToken()
    const headers: Record<string, string> = {}
    if (token) headers.Authorization = `Bearer ${token}`
    const res = await fetchBackend(buildApiUrl('/api/resume'), {
      method: 'POST',
      body: fd,
      headers,
    })
    if (!res.ok) {
      throw new Error(await buildResponseErrorMessage(res, '上传失败'))
    }
    return res.json()
  },
  deleteResume: () => request('/api/resume', { method: 'DELETE' }),
  resumeHistory: () => request<{ items: ResumeHistoryItem[]; max: number }>('/api/resume/history'),
  resumeHistoryApply: (id: number) =>
    request<{ ok: boolean; history_id: number; length: number; preview: string }>(
      `/api/resume/history/${id}/apply`,
      { method: 'POST' },
    ),
  resumeHistoryDelete: (id: number) =>
    request<{ ok: boolean }>(`/api/resume/history/${id}`, { method: 'DELETE' }),
  resumeHistoryDetail: (id: number) => request<ResumeHistoryDetail>(`/api/resume/history/${id}`),
  resumeHistoryUpdate: (id: number, summary: string) =>
    request<{ ok: boolean; length: number }>(`/api/resume/history/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ summary }),
    }),
  start: (device_id?: number | null, candidate_mic_device_id?: number | null) =>
    request('/api/start', {
      method: 'POST',
      body: JSON.stringify({
        ...(device_id != null ? { device_id } : {}),
        ...(candidate_mic_device_id != null ? { candidate_mic_device_id } : {}),
      }),
    }),
  stop: () => request('/api/stop', { method: 'POST' }),
  pause: () => request('/api/pause', { method: 'POST' }),
  resume: (device_id?: number, candidate_mic_device_id?: number | null) => request('/api/unpause', {
    method: 'POST',
    body: JSON.stringify({
      ...(device_id != null ? { device_id } : {}),
      ...(candidate_mic_device_id != null ? { candidate_mic_device_id } : {}),
    }),
  }),
  clear: () => request('/api/clear', { method: 'POST' }),
  ask: (text: string, image?: string) =>
    request('/api/ask', { method: 'POST', body: JSON.stringify({ text, image }) }),
  cancelAsk: () => request('/api/ask/cancel', { method: 'POST' }),
  preflightScenarios: () => request<{ scenarios: { id: string; label: string; question: string; recommended: boolean }[] }>('/api/preflight/scenarios'),
  preflightRun: (scenario_id: string, device_id?: number | null) =>
    request('/api/preflight/run', { method: 'POST', body: JSON.stringify({ scenario_id, device_id: device_id ?? undefined }) }),
  preflightStatus: () => request('/api/preflight/status'),
  examPreflightRun: () =>
    request<{ ok: boolean; preflight_id: string }>('/api/exam-preflight/run', { method: 'POST', body: '{}' }),
  examPreflightStatus: () => request('/api/exam-preflight/status'),
  audioOutputTest: () =>
    request<{ ok: boolean; elapsed_sec: number }>('/api/audio-test/output', { method: 'POST', body: '{}' }),
  audioInputTest: (device_id: number, duration_sec = 1.2) =>
    request<{
      ok: boolean
      device_id: number
      elapsed_sec: number
      samples?: number
      rms: number
      peak: number
      has_signal: boolean
      detail: string
    }>('/api/audio-test/input', { method: 'POST', body: JSON.stringify({ device_id, duration_sec }) }),
  audioInputMonitorStart: (device_id: number) =>
    request<{
      running: boolean
      device_id: number
      rms: number
      peak: number
      level_pct: number
      has_signal: boolean
      error?: string | null
    }>('/api/audio-test/input/start', { method: 'POST', body: JSON.stringify({ device_id }) }),
  audioInputMonitorStatus: () =>
    request<{
      running: boolean
      device_id: number | null
      rms: number
      peak: number
      level_pct: number
      has_signal: boolean
      error?: string | null
    }>('/api/audio-test/input/status'),
  audioInputMonitorStop: () =>
    request<{ running: boolean }>('/api/audio-test/input/stop', { method: 'POST', body: '{}' }),
  /** 服务端截取本机主屏左半幅 + VL 写码（手机端用，不经过手机截图 API） */
  askFromServerScreen: () =>
    request('/api/ask-from-server-screen', { method: 'POST', body: '{}' }),
  captureServerScreen: () =>
    request<{ ok: boolean; image: string }>('/api/capture-server-screen', { method: 'POST', body: '{}' }),
  askFromServerScreens: (images: string[]) =>
    request('/api/ask-from-server-screens', { method: 'POST', body: JSON.stringify({ images }) }),
  getSttStatus: () => request('/api/stt/status'),
  checkModelsHealth: () => request('/api/models/health', { method: 'POST' }),
  /** 当前各模型健康状态（检测中/可用/不可用） */
  getModelsHealth: () => request<{
    health: Record<string, string>
    detail?: Record<string, string>
    latency?: Record<string, number>
  }>('/api/models/health'),
  listRemoteModels: (payload: { api_base_url: string; api_key: string; model_index?: number }) =>
    request<{ models: { id: string; owned_by?: string | null }[] }>('/api/models/list', { method: 'POST', body: JSON.stringify(payload) }),
  checkSingleModelHealth: (index: number) => request('/api/models/health/' + index, { method: 'POST' }),
  probeModelCapabilities: (index: number) =>
    request<{
      ok: boolean
      detail?: string
      latency_ms?: number
      supports_vision: boolean
      supports_think: boolean
      think_style: string
      think_params: Record<string, unknown>
      think_disabled_params: Record<string, unknown>
      vision_detail?: string
      think_detail?: string
      think_disabled_detail?: string
    }>('/api/models/probe/' + index, { method: 'POST' }),
  sttTest: () => request<{ ok: boolean; detail?: string; text?: string }>('/api/stt/test', { method: 'POST' }),

  // Knowledge
  knowledgeSummary: () => request('/api/knowledge/summary'),
  knowledgeHistory: (page: number = 1, pageSize: number = 20) =>
    request(`/api/knowledge/history?page=${page}&page_size=${pageSize}`),
  knowledgeReset: () => request('/api/knowledge/reset', { method: 'DELETE' }),

  // Review (面试复盘)
  reviewSessions: (page: number = 1, pageSize: number = 20) =>
    request(`/api/review/sessions?page=${page}&page_size=${pageSize}`),
  reviewSessionDetail: (sessionId: number) =>
    request(`/api/review/sessions/${sessionId}`),
  reviewUpdateSession: (sessionId: number, data: { title?: string; company?: string; role?: string; application_id?: number | null }) =>
    request(`/api/review/sessions/${sessionId}`, { method: 'PATCH', body: JSON.stringify(data) }),
  reviewTriggerAnalysis: (sessionId: number) =>
    request<{ status: string; message: string }>(`/api/review/sessions/${sessionId}/generate`, { method: 'POST', body: '{}' }),
  reviewCreateManual: (data: { transcript: string; title?: string; company?: string; role?: string; analyze?: boolean }) =>
    request<{ session_id: number; turn_count: number; status: string }>('/api/review/sessions/manual', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  reviewAsrCorrectionTest: (data?: { question?: string; answer?: string }) =>
    request<{
      ok: boolean
      model_name: string
      model: string
      original: string
      corrected: string
      changed: boolean
      detail?: string
    }>('/api/review/asr-correction-test', {
      method: 'POST',
      body: JSON.stringify(data ?? {}),
    }),
  reviewCurrent: () =>
    request('/api/review/current'),
  reviewProfile: () =>
    request('/api/review/profile'),

  // Resume optimizer
  resumeOptimize: (jd: string) =>
    request('/api/resume/optimize', { method: 'POST', body: JSON.stringify({ jd }) }),

  // Token
  tokenStats: () => request('/api/token/stats'),

  // Job tracker (desktop / local SQLite)
  jobTrackerStages: () => request<{ stages: string[] }>('/api/job-tracker/stages'),
  jobTrackerApplications: (params?: { stage?: string; q?: string; sort_by?: string; sort_dir?: string }) => {
    const sp = new URLSearchParams()
    if (params?.stage) sp.set('stage', params.stage)
    if (params?.q) sp.set('q', params.q)
    if (params?.sort_by) sp.set('sort_by', params.sort_by)
    if (params?.sort_dir) sp.set('sort_dir', params.sort_dir)
    const qs = sp.toString()
    return request<{ items: Record<string, unknown>[] }>(`/api/job-tracker/applications${qs ? `?${qs}` : ''}`)
  },
  jobTrackerCreateApplication: (body: Record<string, unknown>) =>
    request('/api/job-tracker/applications', { method: 'POST', body: JSON.stringify(body) }),
  jobTrackerPatchApplication: (id: number, body: Record<string, unknown>) =>
    request(`/api/job-tracker/applications/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  jobTrackerDeleteApplication: (id: number) =>
    request(`/api/job-tracker/applications/${id}`, { method: 'DELETE' }),
  jobTrackerApplicationReviews: (id: number) =>
    request<{ items: Record<string, unknown>[] }>(`/api/job-tracker/applications/${id}/reviews`),
  jobTrackerBatchStage: (ids: number[], stage: string) =>
    request('/api/job-tracker/applications/batch-stage', {
      method: 'PATCH',
      body: JSON.stringify({ ids, stage }),
    }),
  jobTrackerReorderStage: (stage: string, orderedIds: number[]) =>
    request<{ updated: number }>('/api/job-tracker/applications/reorder-stage', {
      method: 'PATCH',
      body: JSON.stringify({ stage, ordered_ids: orderedIds }),
    }),
  jobTrackerListOffers: () => request<{ items: Record<string, unknown>[] }>('/api/job-tracker/offers'),
  jobTrackerUpsertOffer: (body: Record<string, unknown>) =>
    request('/api/job-tracker/offers', { method: 'POST', body: JSON.stringify(body) }),
  jobTrackerPatchOffer: (id: number, body: Record<string, unknown>) =>
    request(`/api/job-tracker/offers/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  jobTrackerDeleteOffer: (id: number) =>
    request(`/api/job-tracker/offers/${id}`, { method: 'DELETE' }),
  jobTrackerCompare: (offer_ids: number[]) =>
    request<{ items: Record<string, unknown>[] }>('/api/job-tracker/compare', {
      method: 'POST',
      body: JSON.stringify({ offer_ids }),
    }),

  // Knowledge Base
  kbStatus: () => request<KBStatus>('/api/kb/status'),
  kbDocs: (limit?: number) =>
    request<{ items: KBDoc[] }>(`/api/kb/docs${limit ? `?limit=${limit}` : ''}`),
  kbSearch: (query: string, k = 4, min_score = 0) =>
    request<{ hits: KBHit[] }>('/api/kb/search', {
      method: 'POST',
      body: JSON.stringify({ query, k, min_score }),
    }),
  kbHitsRecent: (limit = 50) =>
    request<{ items: KBRecentHit[] }>(`/api/kb/hits/recent?limit=${limit}`),
  kbReindex: () => request<Record<string, unknown>>('/api/kb/reindex', { method: 'POST', body: '{}' }),
  kbDelete: (path: string) =>
    request<{ ok: boolean }>(`/api/kb/docs?path=${encodeURIComponent(path)}`, { method: 'DELETE' }),
  kbUpload: async (file: File, subdir = ''): Promise<{ path: string; size: number }> => {
    const fd = new FormData()
    fd.append('file', file)
    if (subdir) fd.append('subdir', subdir)
    const token = getAuthToken()
    const headers: Record<string, string> = {}
    if (token) headers.Authorization = `Bearer ${token}`
    const res = await fetchBackend(buildApiUrl('/api/kb/upload'), { method: 'POST', body: fd, headers })
    if (!res.ok) {
      throw new Error(await buildResponseErrorMessage(res, '上传失败'))
    }
    return res.json()
  },
}
