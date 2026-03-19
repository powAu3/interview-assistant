import { X } from 'lucide-react'
import dayjs from 'dayjs'
import type { Offer } from './types'

const ROWS: { key: keyof Offer | 'company' | 'position'; label: string }[] = [
  { key: 'company', label: '公司' },
  { key: 'position', label: '岗位' },
  { key: 'base_salary', label: '月薪/基数' },
  { key: 'total_pkg_note', label: '总包' },
  { key: 'bonus', label: '奖金' },
  { key: 'equity', label: '股权' },
  { key: 'benefits', label: '福利' },
  { key: 'wfh', label: '远程政策' },
  { key: 'location', label: '地点' },
  { key: 'pros', label: '优点' },
  { key: 'cons', label: '顾虑' },
  { key: 'deadline', label: '截止' },
]

function cellVal(o: Record<string, unknown>, key: string): string {
  const v = o[key]
  if (v == null || v === '') return '—'
  if (key === 'benefits' && Array.isArray(v)) return (v as string[]).join('；') || '—'
  if (key === 'deadline' && typeof v === 'number')
    return dayjs.unix(Math.floor(v)).format('YYYY-MM-DD')
  return String(v)
}

type Props = {
  open: boolean
  items: Offer[]
  onClose: () => void
}

export default function OfferCompareModal({ open, items, onClose }: Props) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/55 backdrop-blur-sm">
      <div className="w-full max-w-[min(96vw,1200px)] max-h-[90vh] flex flex-col rounded-2xl border border-bg-hover bg-bg-secondary shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-bg-hover flex-shrink-0">
          <h2 className="text-sm font-bold text-text-primary">Offer 对比</h2>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-bg-tertiary text-text-muted"
            aria-label="关闭"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="overflow-auto flex-1 p-4">
          {items.length < 2 ? (
            <p className="text-sm text-text-muted text-center py-12">请至少选择 2 个已有 Offer 的记录（勾选「对比」列）</p>
          ) : (
            <table className="w-full border-collapse text-xs min-w-[640px]">
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 bg-[#16161f] text-left py-2 px-3 text-text-muted font-bold border-b border-bg-hover w-28">
                    维度
                  </th>
                  {items.map((o) => (
                    <th
                      key={o.id}
                      className="text-left py-2 px-3 text-text-primary font-bold border-b border-bg-hover min-w-[160px] bg-bg-tertiary/30"
                    >
                      <div className="line-clamp-2">{o.company ?? '—'}</div>
                      <div className="text-[10px] text-text-muted font-normal mt-0.5 line-clamp-1">
                        {o.position ?? ''}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ROWS.map((row) => (
                  <tr key={row.key as string} className="border-b border-bg-tertiary/40 hover:bg-bg-tertiary/15">
                    <td className="sticky left-0 z-10 bg-bg-secondary py-2.5 px-3 text-text-muted font-medium border-r border-bg-hover/50">
                      {row.label}
                    </td>
                    {items.map((o) => {
                      const raw = o as unknown as Record<string, unknown>
                      return (
                        <td
                          key={`${o.id}-${String(row.key)}`}
                          className="py-2.5 px-3 text-text-primary align-top leading-relaxed"
                        >
                          {cellVal(raw, row.key as string)}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
