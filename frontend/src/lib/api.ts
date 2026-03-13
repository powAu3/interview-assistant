const BASE = ''

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

export const api = {
  getConfig: () => request('/api/config'),
  updateConfig: (data: Record<string, any>) =>
    request('/api/config', { method: 'POST', body: JSON.stringify(data) }),
  getOptions: () => request('/api/options'),
  getDevices: () => request('/api/devices'),
  uploadResume: async (file: File) => {
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
  start: (device_id: number) =>
    request('/api/start', { method: 'POST', body: JSON.stringify({ device_id }) }),
  stop: () => request('/api/stop', { method: 'POST' }),
  clear: () => request('/api/clear', { method: 'POST' }),
  ask: (text: string, image?: string) =>
    request('/api/ask', { method: 'POST', body: JSON.stringify({ text, image }) }),
  getSttStatus: () => request('/api/stt/status'),

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
}
