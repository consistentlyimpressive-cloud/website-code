import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

const apiUrl = import.meta.env.VITE_API_URL || ''
if (import.meta.env.PROD && typeof window !== 'undefined' && window.location.protocol === 'https:' && apiUrl.startsWith('http://')) {
  console.error(
    '[MogCheck] VITE_API_URL must use https:// when the site is served over HTTPS or the browser will block API calls (mixed content).'
  )
}

createRoot(document.getElementById('root')).render(
  <App />
)
