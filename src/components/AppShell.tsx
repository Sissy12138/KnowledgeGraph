import type { ReactNode } from 'react'
import AppHeader from './AppHeader'
import AppSidebar from './AppSidebar'

type AppShellProps = {
  children: ReactNode
}

/** 组合全局顶部区域、侧栏和主内容区域。 */
export default function AppShell({ children }: AppShellProps) {
  return (
    <div className="app-shell">
      <AppHeader />
      <div className="app-shell__body">
        <AppSidebar />
        <main className="app-shell__main">{children}</main>
      </div>
    </div>
  )
}
