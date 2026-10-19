import { NavLink } from 'react-router-dom'
import DisplaySettings from './DisplaySettings'

const navigationItems = [
  { label: '知识图谱', to: '/graph' },
  { label: '文献库', to: '/papers' },
  { label: '建议审核', to: '/review' },
  { label: '分析任务', to: '/analysis-jobs' },
  { label: 'Zotero 同步', to: '/zotero' },
  { label: '模型配置', to: '/settings/model' },
  { label: '知识问答', to: '/qa' },
]

/** 显示应用主导航。 */
export default function AppSidebar() {
  return (
    <nav className="app-sidebar" aria-label="主导航">
      <div className="app-sidebar__navigation app-sidebar__navigation--mobile-scroll">
        <p className="app-sidebar__label">工作区</p>
        {navigationItems.map((item) => {
          return (
            <NavLink
              className={({ isActive }) =>
                `app-sidebar__item${isActive ? ' app-sidebar__item--active' : ''}`
              }
              to={item.to}
              key={item.label}
            >
              {item.label}
            </NavLink>
          )
        })}
      </div>
      <DisplaySettings />
    </nav>
  )
}
