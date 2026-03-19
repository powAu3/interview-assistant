import { useMemo, useState, useEffect, useCallback } from 'react'
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type SortingState,
  type ColumnPinningState,
} from '@tanstack/react-table'
import dayjs from 'dayjs'
import { Trash2, Briefcase } from 'lucide-react'
import type { Application, Offer } from './types'
import { STAGE_LABELS, STAGE_ORDER } from './stageConfig'

const columnHelper = createColumnHelper<Application>()

function EditableText({
  value,
  onCommit,
  multiline,
  dense,
}: {
  value: string
  onCommit: (v: string) => void
  multiline?: boolean
  dense?: boolean
}) {
  const [v, setV] = useState(value)
  useEffect(() => setV(value), [value])
  const cls = dense
    ? 'w-full min-w-[4rem] bg-transparent text-xs text-text-primary border border-transparent hover:border-bg-hover rounded px-1.5 py-0.5 focus:border-accent-blue focus:outline-none'
    : 'w-full min-w-[4rem] bg-transparent text-sm text-text-primary border border-transparent hover:border-bg-hover rounded px-2 py-1 focus:border-accent-blue focus:outline-none'
  if (multiline) {
    return (
      <textarea
        value={v}
        rows={2}
        className={`${cls} resize-y min-h-[2.5rem]`}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => {
          if (v !== value) onCommit(v)
        }}
      />
    )
  }
  return (
    <input
      type="text"
      value={v}
      className={cls}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => {
        if (v !== value) onCommit(v)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
      }}
    />
  )
}

function DateCell({
  unix,
  onCommit,
  dense,
}: {
  unix: number | null
  onCommit: (v: number | null) => void
  dense?: boolean
}) {
  const s = unix != null ? dayjs.unix(Math.floor(unix)).format('YYYY-MM-DD') : ''
  return (
    <input
      type="date"
      value={s}
      className={
        dense
          ? 'w-[9.5rem] bg-bg-tertiary/40 text-xs rounded px-1.5 py-0.5 border border-bg-hover'
          : 'w-[10rem] bg-bg-tertiary/40 text-sm rounded px-2 py-1 border border-bg-hover'
      }
      onChange={(e) => {
        const d = e.target.value
        onCommit(d ? dayjs(d).unix() : null)
      }}
    />
  )
}

function TodosCell({
  todos,
  onCommit,
  dense,
}: {
  todos: Application['todos']
  onCommit: (todos: Application['todos']) => void
  dense?: boolean
}) {
  const text = todos.map((t) => t.title).join(' | ')
  const [v, setV] = useState(text)
  useEffect(() => setV(todos.map((t) => t.title).join(' | ')), [todos])
  return (
    <input
      type="text"
      title="多条用 | 分隔"
      placeholder="待办1 | 待办2"
      value={v}
      className={
        dense
          ? 'w-full min-w-[6rem] bg-transparent text-xs text-text-secondary border border-transparent hover:border-bg-hover rounded px-1.5 py-0.5'
          : 'w-full min-w-[8rem] bg-transparent text-sm text-text-secondary border border-transparent hover:border-bg-hover rounded px-2 py-1'
      }
      onChange={(e) => setV(e.target.value)}
      onBlur={() => {
        const parts = v
          .split('|')
          .map((x) => x.trim())
          .filter(Boolean)
        const next = parts.map((title) => ({
          id: crypto.randomUUID(),
          title,
          done: false,
        }))
        const same =
          next.length === todos.length && next.every((n, i) => n.title === todos[i]?.title)
        if (!same) onCommit(next)
      }}
    />
  )
}

type Props = {
  applications: Application[]
  offerByAppId: Map<number, Offer>
  selectedOfferIds: Set<number>
  toggleOfferSelect: (offerId: number) => void
  onPatch: (id: number, patch: Partial<Application>) => void
  onDelete: (id: number) => void
  onOpenOffer: (app: Application) => void
  dense: boolean
  search: string
}

export default function ApplicationsTable({
  applications,
  offerByAppId,
  selectedOfferIds,
  toggleOfferSelect,
  onPatch,
  onDelete,
  onOpenOffer,
  dense,
  search,
}: Props) {
  const [sorting, setSorting] = useState<SortingState>([{ id: 'updated_at', desc: true }])
  const [pinning] = useState<ColumnPinningState>({ left: ['company'] })

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return applications
    return applications.filter(
      (a) =>
        a.company.toLowerCase().includes(q) ||
        a.position.toLowerCase().includes(q) ||
        a.city.toLowerCase().includes(q) ||
        a.notes.toLowerCase().includes(q),
    )
  }, [applications, search])

  const patch = useCallback(
    (id: number, p: Partial<Application>) => {
      onPatch(id, p)
    },
    [onPatch],
  )

  const columns = useMemo(
    () => [
      columnHelper.display({
        id: 'compare',
        header: () => <span title="加入 Offer 对比">对比</span>,
        size: 52,
        cell: ({ row }) => {
          const o = offerByAppId.get(row.original.id)
          if (!o)
            return <span className="text-text-muted/50 text-[10px] text-center block">—</span>
          return (
            <div className="flex justify-center">
              <input
                type="checkbox"
                className="w-3.5 h-3.5 rounded border-bg-hover"
                checked={selectedOfferIds.has(o.id)}
                onChange={() => toggleOfferSelect(o.id)}
                title="选中以对比 Offer"
              />
            </div>
          )
        },
      }),
      columnHelper.accessor('company', {
        header: '公司',
        size: 160,
        cell: ({ row }) => (
          <EditableText
            dense={dense}
            value={row.original.company}
            onCommit={(v) => patch(row.original.id, { company: v })}
          />
        ),
      }),
      columnHelper.accessor('position', {
        header: '岗位',
        size: 140,
        cell: ({ row }) => (
          <EditableText
            dense={dense}
            value={row.original.position}
            onCommit={(v) => patch(row.original.id, { position: v })}
          />
        ),
      }),
      columnHelper.accessor('city', {
        header: '城市',
        size: 88,
        cell: ({ row }) => (
          <EditableText
            dense={dense}
            value={row.original.city}
            onCommit={(v) => patch(row.original.id, { city: v })}
          />
        ),
      }),
      columnHelper.accessor('stage', {
        header: '阶段',
        size: 120,
        cell: ({ row }) => {
          const st = row.original.stage
          const opts = STAGE_ORDER.includes(st as (typeof STAGE_ORDER)[number])
            ? STAGE_ORDER
            : ([st, ...STAGE_ORDER.filter((x) => x !== st)] as typeof STAGE_ORDER)
          return (
            <select
              value={st}
              className={
                dense
                  ? 'max-w-[7.5rem] bg-bg-tertiary/60 text-xs rounded-md border border-bg-hover px-1.5 py-0.5'
                  : 'max-w-[8rem] bg-bg-tertiary/60 text-sm rounded-md border border-bg-hover px-2 py-1'
              }
              onChange={(e) => patch(row.original.id, { stage: e.target.value })}
            >
              {opts.map((s) => (
                <option key={s} value={s}>
                  {STAGE_LABELS[s] ?? s}
                </option>
              ))}
            </select>
          )
        },
      }),
      columnHelper.accessor('applied_at', {
        header: '投递日',
        size: 118,
        cell: ({ row }) => (
          <DateCell
            dense={dense}
            unix={row.original.applied_at}
            onCommit={(v) => patch(row.original.id, { applied_at: v })}
          />
        ),
      }),
      columnHelper.accessor('next_followup_at', {
        header: '下次跟进',
        size: 118,
        cell: ({ row }) => (
          <DateCell
            dense={dense}
            unix={row.original.next_followup_at}
            onCommit={(v) => patch(row.original.id, { next_followup_at: v })}
          />
        ),
      }),
      columnHelper.accessor('interviewer_info', {
        header: '面试官/联系人',
        size: 160,
        cell: ({ row }) => (
          <EditableText
            dense={dense}
            multiline
            value={row.original.interviewer_info}
            onCommit={(v) => patch(row.original.id, { interviewer_info: v })}
          />
        ),
      }),
      columnHelper.accessor('feedback', {
        header: '面经/反馈',
        size: 200,
        cell: ({ row }) => (
          <EditableText
            dense={dense}
            multiline
            value={row.original.feedback}
            onCommit={(v) => patch(row.original.id, { feedback: v })}
          />
        ),
      }),
      columnHelper.accessor('todos', {
        header: '待办',
        size: 160,
        cell: ({ row }) => (
          <TodosCell
            dense={dense}
            todos={row.original.todos}
            onCommit={(todos) => patch(row.original.id, { todos })}
          />
        ),
      }),
      columnHelper.accessor('notes', {
        header: '备注',
        size: 180,
        cell: ({ row }) => (
          <EditableText
            dense={dense}
            multiline
            value={row.original.notes}
            onCommit={(v) => patch(row.original.id, { notes: v })}
          />
        ),
      }),
      columnHelper.accessor('updated_at', {
        id: 'updated_at',
        header: '更新',
        size: 88,
        cell: ({ row }) => (
          <span className="text-[10px] text-text-muted whitespace-nowrap font-mono">
            {dayjs.unix(Math.floor(row.original.updated_at)).format('MM-DD HH:mm')}
          </span>
        ),
      }),
      columnHelper.display({
        id: 'actions',
        header: '',
        size: 88,
        cell: ({ row }) => (
          <div className="flex items-center gap-1">
            <button
              type="button"
              title="编辑 Offer"
              onClick={() => onOpenOffer(row.original)}
              className="p-1.5 rounded-lg text-accent-blue hover:bg-accent-blue/10"
            >
              <Briefcase className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              title="删除"
              onClick={() => {
                if (confirm(`删除「${row.original.company}」这条记录？`)) onDelete(row.original.id)
              }}
              className="p-1.5 rounded-lg text-text-muted hover:text-accent-red hover:bg-accent-red/10"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ),
      }),
    ],
    [dense, offerByAppId, onDelete, onOpenOffer, patch, selectedOfferIds, toggleOfferSelect],
  )

  const table = useReactTable({
    data: filtered,
    columns,
    state: { sorting, columnPinning: pinning },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    enableColumnPinning: true,
    columnResizeMode: 'onChange',
  })

  const cellPad = dense ? 'px-2 py-1' : 'px-3 py-2'
  const headerPad = dense ? 'px-2 py-2' : 'px-3 py-2.5'

  return (
    <div className="rounded-xl border border-bg-hover/80 bg-bg-secondary/40 overflow-hidden shadow-[0_0_0_1px_rgba(255,255,255,0.03)]">
      <div className="overflow-x-auto max-h-[calc(100vh-220px)] overflow-y-auto">
        <table className="w-full border-collapse text-left min-w-[1100px]">
          <thead className="sticky top-0 z-20 bg-[#16161f] shadow-sm border-b border-bg-hover">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((header) => {
                  const pinned = header.column.getIsPinned()
                  const isCompany = header.column.id === 'company'
                  return (
                    <th
                      key={header.id}
                      className={`${headerPad} text-[10px] font-bold uppercase tracking-wider text-text-muted border-b border-bg-hover whitespace-nowrap ${
                        pinned === 'left'
                          ? 'sticky z-30 bg-[#16161f] shadow-[4px_0_12px_rgba(0,0,0,0.2)]'
                          : ''
                      } ${isCompany ? 'left-0 min-w-[140px]' : ''}`}
                      style={
                        pinned === 'left'
                          ? { left: `${header.column.getStart('left')}px` }
                          : undefined
                      }
                    >
                      {header.isPlaceholder
                        ? null
                        : flexRender(header.column.columnDef.header, header.getContext())}
                    </th>
                  )
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr
                key={row.id}
                className="border-b border-bg-tertiary/50 hover:bg-bg-tertiary/25 transition-colors"
              >
                {row.getVisibleCells().map((cell) => {
                  const pinned = cell.column.getIsPinned()
                  const isCompany = cell.column.id === 'company'
                  return (
                    <td
                      key={cell.id}
                      className={`${cellPad} align-top ${pinned === 'left' ? 'sticky z-10 bg-bg-secondary shadow-[4px_0_12px_rgba(0,0,0,0.15)]' : 'bg-bg-secondary/30'} ${isCompany ? 'left-0' : ''}`}
                      style={
                        pinned === 'left'
                          ? { left: `${cell.column.getStart('left')}px` }
                          : undefined
                      }
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {filtered.length === 0 && (
        <div className="py-16 text-center text-text-muted text-sm">暂无数据，点击「新增记录」开始</div>
      )}
    </div>
  )
}
