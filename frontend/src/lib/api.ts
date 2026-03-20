/** 部署到子路径或反向代理时可通过环境变量 VITE_API_BASE 指定 API 根路径，如 '' 或 '/api' */
const BASE = (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_API_BASE ?? ''

async function request<T = any>(url: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${url}`, {
    headers: { 'Content-Type': 'application/json', ...opts?.headers },
    ...opts,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail || res.statusText)
  }
  return res.json()
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
  modelsLayout: (data: { order?: number[]; enabled?: boolean[]; max_parallel_answers?: number }) =>
    request('/api/config/models-layout', { method: 'POST', body: JSON.stringify(data) }),
  getOptions: () => request('/api/options'),
  getDevices: () => request('/api/devices'),
  uploadResume: async (file: File): Promise<ResumeUploadResult> => {
    const fd = new FormData()
    fd.append('file', file)
    const res = await fetch(`${BASE}/api/resume`, { method: 'POST', body: fd })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: 'Upload failed' }))
      throw new Error(err.detail)
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
  start: (device_id: number) =>
    request('/api/start', { method: 'POST', body: JSON.stringify({ device_id }) }),
  stop: () => request('/api/stop', { method: 'POST' }),
  pause: () => request('/api/pause', { method: 'POST' }),
  resume: (device_id?: number) => request('/api/unpause', { method: 'POST', body: JSON.stringify(device_id != null ? { device_id } : {}) }),
  clear: () => request('/api/clear', { method: 'POST' }),
  ask: (text: string, image?: string) =>
    request('/api/ask', { method: 'POST', body: JSON.stringify({ text, image }) }),
  cancelAsk: () => request('/api/ask/cancel', { method: 'POST' }),
  /** 服务端截取本机主屏左半幅 + VL 写码（手机端用，不经过手机截图 API） */
  askFromServerScreen: () =>
    request('/api/ask-from-server-screen', { method: 'POST', body: '{}' }),
  getSttStatus: () => request('/api/stt/status'),
  checkModelsHealth: () => request('/api/models/health', { method: 'POST' }),
  /** 当前各模型健康状态（检测中/可用/不可用） */
  getModelsHealth: () => request<{ health: Record<string, string> }>('/api/models/health'),

  // Knowledge
  knowledgeSummary: () => request('/api/knowledge/summary'),
  knowledgeHistory: (page: number = 1, pageSize: number = 20) =>
    request(`/api/knowledge/history?page=${page}&page_size=${pageSize}`),
  knowledgeReset: () => request('/api/knowledge/reset', { method: 'DELETE' }),

  // Resume optimizer
  resumeOptimize: (jd: string) =>
    request('/api/resume/optimize', { method: 'POST', body: JSON.stringify({ jd }) }),

  // Token
  tokenStats: () => request('/api/token/stats'),

  // Practice
  practiceGenerate: (count?: number) =>
    request('/api/practice/generate', { method: 'POST', body: JSON.stringify({ count: count ?? 6 }) }),
  practiceSubmit: (answer: string) =>
    request('/api/practice/submit', { method: 'POST', body: JSON.stringify({ answer }) }),
  practiceNext: () => request('/api/practice/next', { method: 'POST' }),
  practiceFinish: () => request('/api/practice/finish', { method: 'POST' }),
  practiceReset: () => request('/api/practice/reset', { method: 'POST' }),
  practiceRecord: (action: 'start' | 'stop', device_id?: number) =>
    request('/api/practice/record', { method: 'POST', body: JSON.stringify({ action, device_id }) }),
  practiceStatus: () => request('/api/practice/status'),

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
  jobTrackerBatchStage: (ids: number[], stage: string) =>
    request('/api/job-tracker/applications/batch-stage', {
      method: 'PATCH',
      body: JSON.stringify({ ids, stage }),
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
}
