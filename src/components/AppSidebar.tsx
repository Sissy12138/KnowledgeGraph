import { NavLink } from 'react-router-dom'
import DisplaySettings from './DisplaySettings'

const navigationItems = [
  { label: '知识图谱', to: '/graph' },
  { label: '文献库', to: '/papers' },
  { label: '建议审核', to: '/review' },
  { label: '知识问答', to: null },
]

/** 显示应用主导航；已实现页面使用链接，尚未实现的入口保留为按钮。 */
export default function AppSidebar() {
  return (
    <nav className="app-sidebar" aria-label="主导航">
      <div className="app-sidebar__navigation app-sidebar__navigation--mobile-scroll">
        <p className="app-sidebar__label">工作区</p>
        {navigationItems.map((item) => {
          if (item.to) {
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
          }

          return (
            <button
              className="app-sidebar__item"
              type="button"
              key={item.label}
            >
              {item.label}
            </button>
          )
        })}
      </div>
      <DisplaySettings />
    </nav>
  )
}
