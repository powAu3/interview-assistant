import { useState } from 'react'
import { X, Plus, RotateCcw, GripVertical } from 'lucide-react'
import { Section } from './shared'
import { DEFAULT_QUICK_PROMPTS, getQuickPrompts, saveQuickPrompts } from '../control-bar/quickPrompts'

export default function QuickPromptsEditor() {
  const [prompts, setPrompts] = useState<string[]>(getQuickPrompts)
  const [newPrompt, setNewPrompt] = useState('')

  const persist = (next: string[]) => {
    setPrompts(next)
    saveQuickPrompts(next)
    window.dispatchEvent(new Event('quick-prompts-updated'))
  }

  const addPrompt = () => {
    const trimmed = newPrompt.trim()
    if (!trimmed || prompts.includes(trimmed)) return
    persist([...prompts, trimmed])
    setNewPrompt('')
  }

  const removePrompt = (idx: number) => {
    persist(prompts.filter((_, i) => i !== idx))
  }

  const movePrompt = (idx: number, dir: -1 | 1) => {
    const target = idx + dir
    if (target < 0 || target >= prompts.length) return
    const next = [...prompts]
    ;[next[idx], next[target]] = [next[target], next[idx]]
    persist(next)
  }

  const resetDefaults = () => persist([...DEFAULT_QUICK_PROMPTS])

  return (
    <Section title="快捷提示词" keywords="quick prompt 快捷词 模板 chip pill 简短 详细">
      <p className="text-[10px] text-text-muted -mt-1">点击输入框上方的标签可快速填入提示词，在此自定义列表</p>

      <div className="flex flex-wrap gap-1.5">
        {prompts.map((p, i) => (
          <div key={`${p}-${i}`} className="group flex items-center gap-0.5 px-2 py-1 bg-bg-tertiary/60 rounded-full border border-bg-hover text-xs text-text-secondary">
            <button onClick={() => movePrompt(i, -1)} className="opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity" title="左移">
              <GripVertical className="w-2.5 h-2.5" />
            </button>
            <span className="select-none">{p}</span>
            <button onClick={() => removePrompt(i)}
              className="opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity text-accent-red"
              title="删除">
              <X className="w-3 h-3" />
            </button>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-1.5">
        <input type="text" value={newPrompt}
          onChange={(e) => setNewPrompt(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addPrompt() } }}
          placeholder="输入新的快捷词..."
          className="input-field flex-1" />
        <button onClick={addPrompt} disabled={!newPrompt.trim()}
          className="px-2 py-2 bg-accent-green hover:bg-accent-green/90 text-white text-xs rounded-lg transition-colors disabled:opacity-30 flex-shrink-0"
          title="添加">
          <Plus className="w-3.5 h-3.5" />
        </button>
        <button onClick={resetDefaults}
          className="px-2 py-2 bg-bg-tertiary hover:bg-bg-hover text-text-secondary text-xs rounded-lg transition-colors flex-shrink-0"
          title="恢复默认">
          <RotateCcw className="w-3.5 h-3.5" />
        </button>
      </div>
    </Section>
  )
}
