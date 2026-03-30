import { useState, useEffect, useRef } from 'react'
import { Play, Square, Mic, Send, RotateCcw, FileText, Upload, ChevronRight, Trophy, X, Loader2 } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import { useInterviewStore } from '@/stores/configStore'
import { api } from '@/lib/api'

const CATEGORY_LABELS: Record<string, string> = {
  project: '📁 项目经历',
  basic: '📚 技术基础',
  design: '🏗️ 系统设计',
  comprehensive: '🎯 综合',
}

export default function PracticeMode() {
  const {
    config, devices, practiceStatus, practiceQuestions, practiceIndex,
    practiceEvals, practiceEvalStreaming, practiceReport, practiceReportStreaming,
    practiceRecording, sttLoaded, practiceAnswerDraft, setPracticeAnswerDraft,
  } = useInterviewStore()

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedMic, setSelectedMic] = useState<number | null>(null)
  const [questionCount, setQuestionCount] = useState(6)
  const evalEndRef = useRef<HTMLDivElement>(null)
  const reportEndRef = useRef<HTMLDivElement>(null)

  const mics = devices.filter((d) => !d.is_loopback)

  useEffect(() => {
    if (mics.length === 0) {
      if (selectedMic !== null) setSelectedMic(null)
      return
    }
    if (selectedMic !== null && mics.some((d) => d.id === selectedMic)) return
    setSelectedMic(mics[0].id)
  }, [mics, selectedMic])

  useEffect(() => { evalEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [practiceEvalStreaming])
  useEffect(() => { reportEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [practiceReportStreaming])

  const currentQ = practiceQuestions[practiceIndex]
  const currentEval = practiceEvals.find((e) => e.question_id === currentQ?.id)
  const isEvaluating = practiceStatus === 'evaluating'
  const isLast = practiceIndex >= practiceQuestions.length - 1
  const answeredCount = practiceEvals.length

  const handleGenerate = async () => {
    setLoading(true); setError(null)
    try { await api.practiceGenerate(questionCount) }
    catch (e: any) { setError(e.message) }
    finally { setLoading(false) }
  }

  const handleSubmit = async () => {
    if (!practiceAnswerDraft.trim()) return
    setLoading(true); setError(null)
    try { await api.practiceSubmit(practiceAnswerDraft.trim()) }
    catch (e: any) { setError(e.message) }
    finally { setLoading(false) }
  }

  const handleNext = async () => {
    setPracticeAnswerDraft(''); setError(null)
    try { await api.practiceNext() }
    catch (e: any) { setError(e.message) }
  }

  const handleFinish = async () => {
    setLoading(true); setError(null)
    try { await api.practiceFinish() }
    catch (e: any) { setError(e.message) }
    finally { setLoading(false) }
  }

  const handleReset = async () => {
    setPracticeAnswerDraft(''); setError(null)
    useInterviewStore.getState().resetPractice()
    try { await api.practiceReset() } catch {}
  }

  const handleRecord = async () => {
    if (practiceRecording) {
      try { await api.practiceRecord('stop') } catch {}
    } else {
      if (selectedMic === null) { setError('请选择麦克风'); return }
      try { await api.practiceRecord('start', selectedMic) } catch (e: any) { setError(e.message) }
    }
  }

  // ── Idle: start screen ──
  if (practiceStatus === 'idle' || practiceStatus === 'generating') {
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="max-w-md w-full space-y-6 text-center">
          <div className="space-y-2">
            <Trophy className="w-12 h-12 text-accent-blue mx-auto" />
            <h2 className="text-lg font-semibold text-text-primary">模拟面试练习</h2>
            <p className="text-xs text-text-muted">AI 面试官会根据你的简历和岗位出题，<br/>你回答后获得即时评价和改进建议</p>
          </div>

          {!config?.has_resume && (
            <div className="bg-accent-amber/10 text-accent-amber text-xs px-4 py-3 rounded-lg">
              <p className="font-medium">建议先上传简历</p>
              <p className="text-text-muted mt-1">上传后 AI 会基于你的项目经历出题，更贴近真实面试</p>
              <UploadResumeButton />
            </div>
          )}

          {config?.has_resume && (
            <div className="flex items-center gap-2 justify-center text-xs text-accent-green">
              <FileText className="w-3.5 h-3.5" /> 简历已上传
            </div>
          )}

          <div className="space-y-3">
            <div className="flex items-center justify-center gap-3 text-xs">
              <label className="text-text-muted">出题数量:</label>
              <div className="flex items-center gap-1">
                {[5, 8, 10, 15].map((n) => (
                  <button key={n} onClick={() => setQuestionCount(n)}
                    className={`px-2 py-1 rounded-md transition-colors ${questionCount === n ? 'bg-accent-blue text-white' : 'bg-bg-tertiary text-text-muted hover:text-text-primary border border-bg-hover'}`}>
                    {n}
                  </button>
                ))}
                <input type="number" min={1} max={30} value={questionCount}
                  onChange={(e) => { const v = parseInt(e.target.value); if (v > 0 && v <= 30) setQuestionCount(v) }}
                  className="w-12 bg-bg-tertiary text-text-primary text-center rounded-lg px-1 py-1 border border-bg-hover text-xs ml-1" />
              </div>
            </div>
            <div className="flex items-center justify-center gap-3 text-xs">
              <label className="text-text-muted">岗位:</label>
              <span className="text-text-primary font-medium">{config?.position}</span>
              <label className="text-text-muted ml-2">语言:</label>
              <span className="text-text-primary font-medium">{config?.language}</span>
              <label className="text-text-muted ml-2">维度:</label>
              <span className="text-text-primary font-medium">
                {config?.practice_audience === 'social' ? '社招' : '校招（实习）'}
              </span>
            </div>
          </div>

          <button onClick={handleGenerate} disabled={loading || practiceStatus === 'generating'}
            className="px-6 py-2.5 bg-accent-blue hover:bg-accent-blue/90 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2 mx-auto">
            {practiceStatus === 'generating' ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> 正在出题...</>
            ) : (
              <><Play className="w-4 h-4" /> 开始练习</>
            )}
          </button>

          {error && <p className="text-accent-red text-xs">{error}</p>}
        </div>
      </div>
    )
  }

  // ── Report: final report ──
  if (practiceStatus === 'report' || practiceStatus === 'finished') {
    const reportText = practiceReport || practiceReportStreaming
    return (
      <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4">
        <div className="max-w-2xl mx-auto space-y-4">
          <h2 className="text-lg font-semibold text-text-primary flex items-center gap-2">
            <Trophy className="w-5 h-5 text-accent-blue" /> 面试练习报告
          </h2>

          {/* Score overview */}
          {practiceEvals.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {practiceEvals.map((ev, i) => (
                <div key={i} className="bg-bg-tertiary rounded-lg px-3 py-2 text-xs">
                  <span className="text-text-muted">第 {i + 1} 题</span>
                  <span className={`ml-2 font-semibold ${ev.score >= 7 ? 'text-accent-green' : ev.score >= 5 ? 'text-accent-amber' : 'text-accent-red'}`}>
                    {ev.score}/10
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className="bg-bg-secondary rounded-lg p-4 border border-bg-tertiary">
            <div className="prose-sm text-text-primary text-sm">
              <ReactMarkdown>{reportText}</ReactMarkdown>
              {practiceStatus === 'report' && <span className="inline-block w-2 h-4 bg-accent-blue animate-pulse ml-0.5" />}
            </div>
            <div ref={reportEndRef} />
          </div>

          <div className="flex gap-3 justify-center">
            <button onClick={handleReset}
              className="px-4 py-2 bg-bg-tertiary hover:bg-bg-hover text-text-primary text-xs rounded-lg flex items-center gap-1.5">
              <RotateCcw className="w-3.5 h-3.5" /> 重新开始
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── Questioning: Q&A flow ──
  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-6">
      <div className="max-w-2xl mx-auto space-y-4">
        {/* Progress */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs">
            <span className="text-text-muted">进度</span>
            <div className="flex gap-1">
              {practiceQuestions.map((_, i) => (
                <div key={i} className={`w-6 h-1.5 rounded-full transition-colors ${
                  i < answeredCount ? 'bg-accent-green' : i === practiceIndex ? 'bg-accent-blue' : 'bg-bg-hover'
                }`} />
              ))}
            </div>
            <span className="text-text-primary font-medium">{practiceIndex + 1}/{practiceQuestions.length}</span>
          </div>
          <button onClick={handleReset} className="text-xs text-text-muted hover:text-accent-red flex items-center gap-1">
            <X className="w-3 h-3" /> 退出
          </button>
        </div>

        {/* Question card */}
        {currentQ && (
          <div className="bg-bg-secondary rounded-lg p-4 border border-bg-tertiary space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-xs bg-accent-blue/20 text-accent-blue px-2 py-0.5 rounded-full">
                {CATEGORY_LABELS[currentQ.category] || currentQ.category}
              </span>
              <span className="text-xs text-text-muted">第 {currentQ.id} 题</span>
            </div>
            <p className="text-text-primary text-sm leading-relaxed">{currentQ.question}</p>
          </div>
        )}

        {/* Answer input */}
        {!currentEval && !isEvaluating && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              {sttLoaded && (
                <>
                  <select value={selectedMic ?? ''} onChange={(e) => setSelectedMic(Number(e.target.value))}
                    className="bg-bg-tertiary text-text-primary text-xs rounded-lg px-2 py-1.5 border border-bg-hover max-w-[180px]">
                    {mics.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                  <button onClick={handleRecord}
                    className={`flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg transition-colors ${
                      practiceRecording
                        ? 'bg-accent-red hover:bg-accent-red/90 text-white'
                        : 'bg-bg-tertiary hover:bg-bg-hover text-text-secondary border border-bg-hover'
                    }`}>
                    {practiceRecording ? <><Square className="w-3 h-3" /> 停止录音</> : <><Mic className="w-3 h-3" /> 语音回答</>}
                  </button>
                </>
              )}
            </div>
            <textarea value={practiceAnswerDraft} onChange={(e) => setPracticeAnswerDraft(e.target.value)}
              placeholder="输入你的回答... 也可以点击「语音回答」用麦克风"
              rows={5}
              className="w-full bg-bg-tertiary text-text-primary text-sm rounded-lg px-3 py-2.5 border border-bg-hover focus:outline-none focus:border-accent-blue placeholder:text-text-muted resize-none" />
            <div className="flex items-center justify-between">
              <span className="text-xs text-text-muted">{practiceAnswerDraft.length} 字</span>
              <div className="flex gap-2">
                {answeredCount > 0 && (
                  <button onClick={handleFinish} disabled={loading}
                    className="px-3 py-1.5 text-xs text-text-muted hover:text-accent-blue">
                    提前结束 →
                  </button>
                )}
                <button onClick={handleSubmit} disabled={loading || !practiceAnswerDraft.trim()}
                  className="flex items-center gap-1.5 px-4 py-1.5 bg-accent-blue hover:bg-accent-blue/90 text-white text-xs font-medium rounded-lg disabled:opacity-40">
                  <Send className="w-3.5 h-3.5" /> 提交回答
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Evaluating spinner */}
        {isEvaluating && !practiceEvalStreaming && (
          <div className="flex items-center justify-center gap-2 py-6 text-text-muted text-sm">
            <Loader2 className="w-4 h-4 animate-spin" /> AI 面试官正在评价你的回答...
          </div>
        )}

        {/* Streaming evaluation */}
        {(practiceEvalStreaming || currentEval) && (
          <div className="bg-bg-secondary rounded-lg p-4 border border-bg-tertiary space-y-2">
            <h3 className="text-xs font-semibold text-accent-blue flex items-center gap-1">
              📝 面试官评价
              {currentEval && <span className={`ml-2 px-2 py-0.5 rounded-full text-xs ${
                currentEval.score >= 7 ? 'bg-accent-green/20 text-accent-green'
                  : currentEval.score >= 5 ? 'bg-accent-amber/20 text-accent-amber'
                  : 'bg-accent-red/20 text-accent-red'
              }`}>{currentEval.score}/10</span>}
            </h3>
            <div className="prose-sm text-text-primary text-sm">
              <ReactMarkdown>{currentEval?.feedback || practiceEvalStreaming}</ReactMarkdown>
              {isEvaluating && practiceEvalStreaming && <span className="inline-block w-2 h-4 bg-accent-blue animate-pulse ml-0.5" />}
            </div>
            <div ref={evalEndRef} />
          </div>
        )}

        {/* Next / Finish */}
        {currentEval && !isEvaluating && (
          <div className="flex justify-center gap-3">
            {!isLast ? (
              <button onClick={handleNext}
                className="flex items-center gap-1.5 px-5 py-2 bg-accent-blue hover:bg-accent-blue/90 text-white text-sm font-medium rounded-lg">
                下一题 <ChevronRight className="w-4 h-4" />
              </button>
            ) : (
              <button onClick={handleFinish} disabled={loading}
                className="flex items-center gap-1.5 px-5 py-2 bg-accent-green hover:bg-accent-green/90 text-white text-sm font-medium rounded-lg disabled:opacity-50">
                <Trophy className="w-4 h-4" /> 生成面试报告
              </button>
            )}
          </div>
        )}

        {error && (
          <div className="text-accent-red text-xs bg-accent-red/10 px-3 py-2 rounded-lg flex items-center justify-between">
            {error} <button onClick={() => setError(null)}><X className="w-3 h-3" /></button>
          </div>
        )}
      </div>
    </div>
  )
}


function UploadResumeButton() {
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const res = await api.uploadResume(file)
      useInterviewStore.getState().setConfig(await api.getConfig())
      if (res.parsed) {
        useInterviewStore.getState().setToastMessage('简历已解析并选用')
      } else {
        useInterviewStore.getState().setToastMessage(
          `已保存到历史，解析未成功：${res.parse_error || '可在底栏「历史」中重试'}`,
        )
      }
    } catch (err) {
      useInterviewStore.getState().setToastMessage(err instanceof Error ? err.message : '上传失败')
    }
    setUploading(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  return (
    <>
      <input ref={fileRef} type="file" accept=".pdf,.txt,.md,.doc,.docx" onChange={handleUpload} className="hidden" />
      <button onClick={() => fileRef.current?.click()} disabled={uploading}
        className="mt-2 px-3 py-1.5 bg-accent-amber/20 hover:bg-accent-amber/30 text-accent-amber text-xs rounded-lg inline-flex items-center gap-1">
        <Upload className="w-3 h-3" /> {uploading ? '上传中...' : '上传简历'}
      </button>
    </>
  )
}
