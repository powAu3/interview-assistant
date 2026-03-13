import { useState } from 'react'
import { useInterviewStore } from '@/stores/configStore'
import { api } from '@/lib/api'
import { FileSearch, Upload } from 'lucide-react'
import ReactMarkdown from 'react-markdown'

export default function ResumeOptimizer() {
  const [jdText, setJdText] = useState('')
  const { config, resumeOptStreaming, resumeOptResult, resumeOptLoading } = useInterviewStore()

  const displayText = resumeOptResult || resumeOptStreaming

  const handleAnalyze = async () => {
    if (!jdText.trim()) return
    if (!config?.has_resume) {
      alert('请先在设置中上传简历')
      return
    }
    try {
      await api.resumeOptimize(jdText.trim())
    } catch (e: any) {
      alert(e.message || '分析失败')
    }
  }

  return (
    <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
      {/* Left: JD input */}
      <div className="md:w-[35%] md:min-w-[280px] border-b md:border-b-0 md:border-r border-bg-tertiary flex flex-col p-4 gap-3 flex-shrink-0">
        <div className="flex items-center gap-2">
          <FileSearch className="w-4 h-4 text-accent-blue" />
          <h3 className="text-sm font-semibold text-text-primary">简历优化</h3>
        </div>

        {!config?.has_resume && (
          <div className="flex items-center gap-2 bg-accent-amber/10 text-accent-amber text-xs px-3 py-2 rounded-lg">
            <Upload className="w-3.5 h-3.5 flex-shrink-0" />
            <span>请先上传简历（在设置或实时辅助底部操作栏）</span>
          </div>
        )}

        <div className="flex-1 flex flex-col gap-2 min-h-0">
          <label className="text-xs text-text-muted">粘贴目标岗位 JD</label>
          <textarea
            value={jdText}
            onChange={e => setJdText(e.target.value)}
            placeholder="将招聘 JD 粘贴到这里..."
            className="flex-1 min-h-[150px] md:min-h-0 bg-bg-tertiary text-text-primary text-xs rounded-lg p-3 border border-bg-hover focus:outline-none focus:border-accent-blue resize-none"
          />
        </div>

        <button
          onClick={handleAnalyze}
          disabled={resumeOptLoading || !jdText.trim() || !config?.has_resume}
          className="w-full py-2.5 bg-accent-blue text-white text-xs font-medium rounded-lg hover:bg-accent-blue/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {resumeOptLoading ? '分析中...' : '开始分析'}
        </button>
      </div>

      {/* Right: result */}
      <div className="flex-1 overflow-y-auto p-4">
        {!displayText ? (
          <div className="h-full flex items-center justify-center text-text-muted text-xs">
            <div className="text-center space-y-2">
              <FileSearch className="w-8 h-8 mx-auto opacity-30" />
              <p>输入 JD 后点击"开始分析"</p>
              <p className="text-[10px]">将对比简历与 JD，给出匹配度评分和修改建议</p>
            </div>
          </div>
        ) : (
          <div className="prose prose-invert prose-sm max-w-none
            prose-headings:text-text-primary prose-headings:text-sm prose-headings:font-semibold prose-headings:mt-4 prose-headings:mb-2
            prose-p:text-text-secondary prose-p:text-xs prose-p:leading-relaxed
            prose-li:text-text-secondary prose-li:text-xs
            prose-strong:text-text-primary
            prose-table:text-xs
            prose-th:text-text-primary prose-th:bg-bg-tertiary prose-th:px-2 prose-th:py-1
            prose-td:text-text-secondary prose-td:px-2 prose-td:py-1 prose-td:border-bg-hover
          ">
            <ReactMarkdown>{displayText}</ReactMarkdown>
            {resumeOptLoading && (
              <span className="inline-block w-1.5 h-3 bg-accent-blue animate-pulse rounded-sm ml-0.5" />
            )}
          </div>
        )}
      </div>
    </div>
  )
}
