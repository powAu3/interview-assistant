import React from 'react'
import ReactDOM from 'react-dom/client'
import './lib/auth' // 抽取 URL 中的 ?t=<token>(必须先于其他 import 触发副作用)
import App from './App'
import InterviewOverlay from './components/InterviewOverlay'
import { markStandalone } from './lib/wsLeader'
import './index.css'

const isOverlayView = new URLSearchParams(window.location.search).get('overlay') === '1'

// Overlay 窗口跳过 BroadcastChannel leader 选举，独立持有 WS。
// 见 lib/wsLeader.ts:markStandalone 注释。必须在 useInterviewWS 触发 init 之前。
if (isOverlayView) markStandalone()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {isOverlayView ? <InterviewOverlay /> : <App />}
  </React.StrictMode>,
)
