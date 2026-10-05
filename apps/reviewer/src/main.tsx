import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import { App } from './app/App'
import { PreferencesProvider } from './lib/usePreferences'
import { ThemeProvider } from './app/ThemeProvider'
import './style.css'

const root = document.getElementById('root')
if (!root) throw new Error('Missing application root')
if (window.reviewerDesktop) {
  document.documentElement.dataset.desktopPlatform = window.reviewerDesktop.platform
}
createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <PreferencesProvider>
        <ThemeProvider>
          <App />
        </ThemeProvider>
      </PreferencesProvider>
    </BrowserRouter>
  </StrictMode>,
)
