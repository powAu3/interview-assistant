import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import QRCode from 'qrcode'

import NetworkQRCode from './NetworkQRCode'

const qrcodeMock = vi.hoisted(() => ({
  toDataURL: vi.fn(),
}))

vi.mock('qrcode', () => ({
  default: qrcodeMock,
}))

vi.mock('@/lib/backendUrl', () => ({
  buildApiUrl: (path: string) => path,
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('NetworkQRCode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    qrcodeMock.toDataURL.mockResolvedValue('data:image/png;base64,qr')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders the LAN URL and QR image after network info loads', async () => {
    const json = vi.fn().mockResolvedValue({ url: 'http://192.168.1.9:8000' })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json }))

    render(<NetworkQRCode />)

    expect(await screen.findByText('http://192.168.1.9:8000')).toBeInTheDocument()
    await waitFor(() => {
      expect(QRCode.toDataURL).toHaveBeenCalledWith('http://192.168.1.9:8000', {
        width: 200,
        margin: 2,
        color: { dark: '#000000', light: '#ffffff' },
      })
    })
    expect(screen.getByRole('img', { name: 'QR Code' })).toHaveAttribute('src', 'data:image/png;base64,qr')
  })

  it('stops processing network info when unmounted before fetch resolves', async () => {
    const fetchResult = deferred<{ json: () => Promise<{ url: string }> }>()
    const json = vi.fn().mockResolvedValue({ url: 'http://192.168.1.9:8000' })
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(fetchResult.promise))

    const { unmount } = render(<NetworkQRCode />)
    unmount()

    await act(async () => {
      fetchResult.resolve({ json })
      await fetchResult.promise
      await Promise.resolve()
    })

    expect(json).not.toHaveBeenCalled()
    expect(QRCode.toDataURL).not.toHaveBeenCalled()
  })
})
