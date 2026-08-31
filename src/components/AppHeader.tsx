/** 显示项目名称、当前阶段和连接状态。 */
export default function AppHeader() {
  return (
    <header className="app-header">
      <div>
        <strong className="app-header__brand">研知图</strong>
        <span className="app-header__subtitle">RESEARCH KG</span>
      </div>
      <div className="app-header__meta">
        <span className="app-header__stage">阶段 1 · 应用外壳</span>
        <span className="app-header__status">Zotero 演示连接</span>
      </div>
    </header>
  )
}
