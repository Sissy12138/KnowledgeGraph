# 研知图前端阶段 0–1 学习笔记 v0.1

## 1. 先建立整体直觉

打开项目时发生的事情可以概括为：

```text
你修改 src 中的代码
        ↓
Vite 读取并转换代码
        ↓
Node.js 提供开发工具运行环境
        ↓
浏览器接收转换后的 HTML、CSS 和 JavaScript
        ↓
React 把组件渲染成页面
```

### 浏览器

浏览器负责显示网页和执行前端 JavaScript。它不知道怎样直接执行 TypeScript 或 TSX，因此需要 Vite 先转换代码。

### Node.js

Node.js 让 JavaScript 能在浏览器之外运行。本项目中，它主要用来运行 Vite、测试工具和构建工具，而不是显示页面。

### npm

npm 是 Node.js 生态的包管理工具：

- `npm install`：根据 `package.json` 下载依赖；
- `npm run dev`：执行名为 `dev` 的项目脚本；
- `npm run test`：执行测试脚本；
- `npm run build`：执行生产构建脚本。

### Vite

Vite 是开发和构建工具。开发时，它启动本地服务器并提供热更新：保存文件后，浏览器通常不需要手动刷新就能看到变化。

`localhost` 或 `127.0.0.1` 都表示当前电脑。网页没有上传到互联网，只有本机能通过这个开发地址访问。

## 2. React 组件是什么

组件是一个负责输出部分界面的函数。例如：

```tsx
function ProjectTitle() {
  return <h1>研知图</h1>
}
```

组件名称以大写字母开头。其他组件可以像使用 HTML 标签一样使用它：

```tsx
function App() {
  return <ProjectTitle />
}
```

本阶段的组件树是：

```text
App
└─ AppShell
   ├─ AppHeader
   ├─ AppSidebar
   └─ main
      └─ 欢迎内容
```

组件树表示“谁包含谁”，不是文件夹树。

## 3. TSX 是什么

`.tsx` 文件允许在 TypeScript 中书写类似 HTML 的 JSX 标签：

```tsx
const projectName: string = '研知图'

function Header() {
  return <header>{projectName}</header>
}
```

这里同时包含 TypeScript、JSX 和花括号中的 JavaScript 表达式。浏览器不会直接运行 TSX；Vite 会先将它转换成浏览器理解的 JavaScript。

## 4. `import` 和 `export`

组件定义在一个文件中，需要先导出：

```tsx
export default function AppHeader() {
  return <header>研知图</header>
}
```

另一个文件再导入：

```tsx
import AppHeader from './components/AppHeader'
```

- `export`：允许其他文件使用这里的内容；
- `import`：把其他文件公开的内容引入当前文件；
- `./`：从当前文件所在位置开始找路径。

## 5. `children` 是什么

`AppShell` 负责固定的顶部区域和侧栏，但主内容会变化，因此它接收 `children`：

```tsx
<AppShell>
  <h1>这里是变化的主内容</h1>
</AppShell>
```

标签之间的内容就是 `children`。它让应用外壳可以包住不同页面，而不必为每个页面复制顶部区域和侧栏。

## 6. CSS 变量与响应式布局

`src/styles/tokens.css` 中的变量统一保存颜色和圆角：

```css
:root {
  --color-primary: #4f46e5;
  --color-background: #f2f3f8;
}
```

其他样式通过 `var(...)` 使用。这样以后更换主题色时，不必在许多文件中逐个搜索颜色值。

响应式布局表示页面会根据窗口宽度改变排列方式。本项目在宽屏时使用左侧导航，在窗口小于 `760px` 时将导航改为横向。

## 7. 为什么测试要先失败

本阶段采用“红—绿—整理”循环：

1. **红**：先写期望行为，运行后确认失败；
2. **绿**：写最少代码让测试通过；
3. **整理**：在测试保护下改善结构。

测试先要求页面出现标题。最初页面没有这个标题，因此测试失败；加入标题后测试通过。这证明测试确实能发现“欢迎标题丢失”。如果测试一开始就通过，我们无法确定它是否真的检查了目标行为。

## 8. 当前文件分别负责什么

| 文件 | 单一职责 |
|---|---|
| `src/main.tsx` | 找到浏览器中的根节点并启动 React |
| `src/App.tsx` | 组合当前应用外壳与欢迎内容 |
| `src/App.test.tsx` | 检查应用欢迎标题 |
| `src/components/AppShell.tsx` | 组合顶部区域、侧栏和主内容 |
| `src/components/AppHeader.tsx` | 显示品牌、阶段和演示连接状态 |
| `src/components/AppSidebar.tsx` | 显示四项主导航 |
| `src/components/AppShell.test.tsx` | 检查应用外壳的语义结构 |
| `src/styles/tokens.css` | 统一保存基础视觉变量 |
| `src/styles/layout.css` | 控制宽屏和窄屏布局 |
| `src/index.css` | 设置全局基础样式 |
| `src/test/setup.ts` | 为组件测试加载浏览器断言能力 |

## 9. 你现在应该能解释的问题

尝试不用背术语地回答：

1. 为什么运行网页需要保持 `npm run dev` 的终端开启？
2. `AppShell` 为什么需要 `children`？
3. 为什么颜色放在 `tokens.css`，布局放在 `layout.css`？
4. 测试先失败有什么价值？

## 10. 小练习

1. 启动项目；
2. 打开 `src/App.tsx`；
3. 把“研知图前端开发环境已就绪”改成“我开始搭建研知图前端了”；
4. 保存并观察浏览器自动更新；
5. 运行 `npm run test`，观察测试为什么失败；
6. 把标题改回原文，再运行测试并确认通过。

这个练习说明：页面文字与测试约定相互关联。改变需求时，应该先决定是否需要同步更新测试，而不是看到失败就随意删除测试。
