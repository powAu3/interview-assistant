import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { KBDoc, KBHit, KBRecentHit, KBStatus } from '@/lib/api'

export interface KbHitsPayload {
  qa_id: string
  latency_ms: number
  degraded: boolean
  hit_count: number
  hits: KBHit[]
  ts: number
}

interface KbState {
  drawerOpen: boolean
  setDrawerOpen: (v: boolean) => void
  toggleDrawer: () => void

  status: KBStatus | null
  setStatus: (s: KBStatus | null) => void

  docs: KBDoc[]
  setDocs: (d: KBDoc[]) => void

  recentHits: KBRecentHit[]
  setRecentHits: (h: KBRecentHit[]) => void

  /** 由 ws kb_hits 写入,key=qa_id; 用于 AnswerPanel 上方的 KbReferenceBanner。 */
  hitsByQaId: Record<string, KbHitsPayload>
  appendHits: (p: Omit<KbHitsPayload, 'ts'>) => void
  clearHits: (qaId?: string) => void
}

export const useKbStore = create<KbState>()(
  persist(
    (set, get) => ({
      drawerOpen: false,
      setDrawerOpen: (v) => set({ drawerOpen: v }),
      toggleDrawer: () => set({ drawerOpen: !get().drawerOpen }),

      status: null,
      setStatus: (s) => set({ status: s }),

      docs: [],
      setDocs: (d) => set({ docs: d }),

      recentHits: [],
      setRecentHits: (h) => set({ recentHits: h }),

      hitsByQaId: {},
      appendHits: (p) =>
        set((s) => ({
          hitsByQaId: {
            ...s.hitsByQaId,
            [p.qa_id]: { ...p, ts: Date.now() },
          },
        })),
      clearHits: (qaId) =>
        set((s) => {
          if (!qaId) return { hitsByQaId: {} }
          if (!(qaId in s.hitsByQaId)) return {}
          const { [qaId]: _, ...rest } = s.hitsByQaId
          return { hitsByQaId: rest }
        }),
    }),
    {
      name: 'kb-store-v1',
      partialize: (s) => ({ drawerOpen: s.drawerOpen }),
    },
  ),
)
