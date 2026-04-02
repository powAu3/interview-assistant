import { useState, useEffect } from 'react'
import { Smartphone } from 'lucide-react'
import QRCode from 'qrcode'
import { GradientCard } from './shared'

export default function NetworkQRCode() {
  const [qrSrc, setQrSrc] = useState<string | null>(null)
  const [networkUrl, setNetworkUrl] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/network-info')
      .then(r => r.json())
      .then(async (data) => {
        setNetworkUrl(data.url)
        const src = await QRCode.toDataURL(data.url, {
          width: 200,
          margin: 2,
          color: { dark: '#000000', light: '#ffffff' },
        })
        setQrSrc(src)
      })
      .catch(() => {})
  }, [])

  if (!networkUrl) return null

  return (
    <GradientCard className="p-4 space-y-3">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-text-muted uppercase tracking-wider">
        <Smartphone className="w-3.5 h-3.5" />
        手机扫码访问
      </div>
      <div className="flex flex-col items-center gap-2">
        {qrSrc && <img src={qrSrc} alt="QR Code" className="rounded-lg" width={160} height={160} />}
        <p className="text-[11px] text-accent-blue break-all text-center select-all">{networkUrl}</p>
        <p className="text-[10px] text-text-muted text-center">手机和电脑需在同一 WiFi 下，音频在电脑端采集</p>
      </div>
    </GradientCard>
  )
}
