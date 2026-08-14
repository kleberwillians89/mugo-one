import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AuthRoot } from './Auth'
import './styles/tokens.css'
import './styles.css'
import './enhancements.css'
import './auth.css'
import './mugo.css'
import './styles/rebrand-v2.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode><AuthRoot /></StrictMode>,
)
