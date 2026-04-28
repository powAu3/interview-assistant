import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, getErrorMessage } from './api'

function jsonResponse(body: unknown, init: ResponseInit) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  })
}

describe('api error handling', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('formats FastAPI validation detail arrays into readable field messages', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      jsonResponse(
        {
          detail: [
            {
              loc: ['body', 'screen_capture_region'],
              msg: 'Input should be one of full,left_half',
            },
          ],
        },
        { status: 422, statusText: 'Unprocessable Entity' },
      ),
    ))

    await expect(api.getConfig()).rejects.toThrow(
      '请求失败 (422): body.screen_capture_region: Input should be one of full,left_half',
    )
  })

  it('keeps non-json server failures actionable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response('upstream gateway timeout', { status: 504, statusText: 'Gateway Timeout' }),
    ))

    await expect(api.getConfig()).rejects.toThrow(
      '请求失败 (504): upstream gateway timeout',
    )
  })

  it('normalizes network failures to a product-facing backend message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))

    await expect(api.getConfig()).rejects.toThrow(
      '无法连接后端服务，请确认应用服务已启动后重试',
    )
  })

  it('normalizes upload network failures to the same backend message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))

    await expect(api.uploadResume(new File(['demo'], 'resume.pdf'))).rejects.toThrow(
      '无法连接后端服务，请确认应用服务已启动后重试',
    )
    await expect(api.kbUpload(new File(['demo'], 'notes.md'))).rejects.toThrow(
      '无法连接后端服务，请确认应用服务已启动后重试',
    )
  })

  it('extracts safe messages from unknown caught values', () => {
    expect(getErrorMessage(new Error('boom'))).toBe('boom')
    expect(getErrorMessage({ detail: 'backend says no' })).toBe('backend says no')
    expect(getErrorMessage(null, '兜底失败')).toBe('兜底失败')
  })
})
