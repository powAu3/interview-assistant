import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import InterviewOverlay from './components/InterviewOverlay'
import './index.css'

const isOverlayView = new URLSearchParams(window.location.search).get('overlay') === '1'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {isOverlayView ? <InterviewOverlay /> : <App />}
  </React.StrictMode>,
)
