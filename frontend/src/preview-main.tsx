import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import './index.css'
import './styles/tokens.css'
import './styles/layout.css'
import App from './App.tsx'
import {
  DisplayPreferencesProvider,
  readStoredDisplayPreferences,
} from './styles/display-preferences'
import { applyAppTheme, applyFontScale } from './styles/app-theme.ts'

const initialPreferences = readStoredDisplayPreferences()
applyAppTheme(initialPreferences.themeId)
applyFontScale(initialPreferences.fontScalePercent)

// 这份离线交付件用于审阅“分析完成后”的论文页面。
if (!window.location.hash) window.location.hash = '#/papers/paper-001'

/** 离线预览使用 HashRouter，确保直接双击 HTML 时页面导航仍然有效。 */
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DisplayPreferencesProvider initialPreferences={initialPreferences}>
      <HashRouter>
        <App />
      </HashRouter>
    </DisplayPreferencesProvider>
  </StrictMode>,
)
