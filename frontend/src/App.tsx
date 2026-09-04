import './App.css'
import { Navigate, Route, Routes } from 'react-router-dom'
import AppShell from './components/AppShell'
import GraphPage from './features/graph/GraphPage'
import PaperDetailPage from './features/papers/PaperDetailPage'
import PaperListPage from './features/papers/PaperListPage'
import SuggestionReviewPage from './features/suggestions/SuggestionReviewPage'

/** 组合应用外壳与当前默认的论文列表页面。 */
function App() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<Navigate to="/papers" replace />} />
        <Route path="/papers" element={<PaperListPage />} />
        <Route path="/papers/:paperId" element={<PaperDetailPage />} />
        <Route path="/graph" element={<GraphPage />} />
        <Route path="/review" element={<SuggestionReviewPage />} />
        <Route path="*" element={<Navigate to="/papers" replace />} />
      </Routes>
    </AppShell>
  )
}

export default App
