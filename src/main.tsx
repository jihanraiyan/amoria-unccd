import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Self-hosted fonts so the game works offline once loaded.
import '@fontsource-variable/fraunces/full.css'
import '@fontsource-variable/fraunces/full-italic.css'
import '@fontsource-variable/figtree/index.css'
import './index.css'
import App from './app/App'

const root = document.getElementById('root')
if (!root) throw new Error('Amoria could not find its #root element.')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
