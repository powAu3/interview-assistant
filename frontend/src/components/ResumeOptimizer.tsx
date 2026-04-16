import { useState, useRef } from 'react'
import { useInterviewStore } from '@/stores/configStore'
import { useUiPrefsStore } from '@/stores/uiPrefsStore'
import { isLightColorScheme } from '@/lib/colorScheme'
import { api } from '@/lib/api'
import { refreshConfig } from '@/lib/configSync'
import { FileSearch, Upload, FileText, X } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import { ResumeHistoryPanel } from '@/components/ResumeHistory'

export default function ResumeOptimizer() {
  const [jdText, setJdText] = useState('')
  const { config, resumeOptStreaming, resumeOptResult, resumeOptLoading, setToastMessage } =
    useInterviewStore()
  const colorScheme = useUiPrefsStore((s) => s.colorScheme)
  const lightMarkdown = isLightColorScheme(colorScheme)
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)

  const displayText = resumeOptResult || resumeOptStreaming

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    setUploadError(null)
    try {
      const res = await api.uploadResume(file)
      await refreshConfig()
      if (res.parsed) {
        setToastMessage('简历已解析并选用')
        setUploadError(null)
      } else {
        setUploadError(`已保存到历史，解析未成功：${res.parse_error || '请检查格式'}`)
        setToastMessage('文件已保存，可在历史中「选用」重试解析')
      }
    } catch (err: any) {
      setUploadError(err.message || '上传失败')
    }
    setUploading(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  const handleRemoveResume = async () => {
    await api.deleteResume()
    await refreshConfig()
  }

  const handleAnalyze = async () => {
    if (!jdText.trim()) return
    if (!config?.has_resume) {
      setUploadError('请先上传简历')
      return
    }
    try {
      await api.resumeOptimize(jdText.trim())
    } catch (e: any) {
      setUploadError(e.message || '分析失败')
    }
  }

  return (
    <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
      {/* Left: input area */}
      <div className="md:w-[35%] md:min-w-[280px] border-b md:border-b-0 md:border-r border-bg-tertiary flex flex-col p-4 gap-3 flex-shrink-0">
        <div className="flex items-center gap-2">
          <FileSearch className="w-4 h-4 text-accent-blue" />
          <h3 className="text-sm font-semibold text-text-primary">简历优化</h3>
        </div>

        {/* Resume upload area */}
        <div className="space-y-2">
          <label className="text-xs text-text-muted">简历</label>
          <input ref={fileRef} type="file" accept=".pdf,.txt,.md,.doc,.docx" onChange={handleUpload} className="hidden" />
          {config?.has_resume ? (
            <div className="flex items-center gap-2 bg-accent-green/10 text-accent-green text-xs px-3 py-2 rounded-lg">
              <FileText className="w-3.5 h-3.5 flex-shrink-0" />
              <span className="flex-1">简历已上传</span>
              <button onClick={() => fileRef.current?.click()} className="text-accent-blue text-[10px] hover:underline">
                更换
              </button>
              <button onClick={handleRemoveResume} className="text-text-muted hover:text-accent-red">
                <X className="w-3 h-3" />
              </button>
            </div>
          ) : (
            <button onClick={() => fileRef.current?.click()} disabled={uploading}
              className="w-full flex items-center justify-center gap-2 py-3 bg-bg-tertiary hover:bg-bg-hover text-text-secondary text-xs rounded-lg transition-colors border border-dashed border-bg-hover disabled:opacity-50">
              <Upload className="w-4 h-4" />
              <span>{uploading ? '上传中...' : '上传简历（PDF / DOCX / TXT / MD）'}</span>
            </button>
          )}
        </div>

        <ResumeHistoryPanel />

        {uploadError && (
          <div className="flex items-center gap-2 bg-accent-red/10 text-accent-red text-xs px-3 py-2 rounded-lg">
            <span className="flex-1">{uploadError}</span>
            <button onClick={() => setUploadError(null)}><X className="w-3 h-3" /></button>
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
              <p>上传简历 → 粘贴 JD → 点击"开始分析"</p>
              <p className="text-[10px]">将对比简历与 JD，给出匹配度评分和修改建议</p>
            </div>
          </div>
        ) : (
          <div
            className={`prose prose-sm max-w-none markdown-body
            ${lightMarkdown ? '' : 'prose-invert'}
            prose-headings:text-text-primary prose-headings:text-sm prose-headings:font-semibold prose-headings:mt-4 prose-headings:mb-2
            prose-p:text-text-secondary prose-p:text-xs prose-p:leading-relaxed
            prose-li:text-text-secondary prose-li:text-xs
            prose-strong:text-text-primary
            prose-table:text-xs
            prose-th:text-text-primary prose-th:bg-bg-tertiary prose-th:px-2 prose-th:py-1
            prose-td:text-text-secondary prose-td:px-2 prose-td:py-1 prose-td:border-bg-hover
          `}
          >
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
