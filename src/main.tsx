import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DisplayPreferencesProvider initialPreferences={initialPreferences}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </DisplayPreferencesProvider>
  </StrictMode>,
)
