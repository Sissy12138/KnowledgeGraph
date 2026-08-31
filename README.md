# 研知图正式前端：第一版 Mock 交付

这是从静态界面原型迁移出来的正式 React 前端工程。目前包含文献列表与详情、证据候选审核、知识图谱、主题与字号设置，以及配套 Mock 数据和自动化测试。

现有静态原型仍保存在本目录的上一级：`../yzt-frontend-mockup.html`。正式工程不会覆盖原型。

## 第一次启动

打开 PowerShell，依次运行：

```powershell
Set-Location '<克隆后的仓库目录>'
npm ci
npm run dev
```

终端出现本地地址后，在浏览器中打开该地址，通常是：

```text
http://localhost:5173
```

停止开发服务器：在正在运行服务器的 PowerShell 窗口按 `Ctrl + C`。

以后再次开发时，依然进入本工程目录并运行 `npm run dev`，不必每次重复 `npm ci`。只有首次下载项目或依赖声明变化时才需要重新安装。

## 无需安装的离线预览

直接双击以下文件即可使用当前 Mock 数据预览界面：

```text
preview/20260831_yanzhitu_frontend_mock_preview_v01.html
```

离线预览使用 Hash 路由，页面切换不会访问真实后端。重新生成该文件：

```powershell
npm run build:preview
```

## 常用检查

运行自动化测试：

```powershell
npm run test
```

检查能否生成生产版本：

```powershell
npm run build
```

构建成功后，输出位于 `dist/`。`dist/` 是工具生成的结果，不是日常编辑源码的位置。

## 主要目录

```text
src/
├─ components/       应用外壳组件与组件测试
├─ styles/           颜色变量和页面布局
├─ test/             测试环境配置
├─ App.tsx           当前页面内容
├─ App.test.tsx      页面行为测试
├─ App.css           当前页面内容样式
├─ index.css         全局基础样式
└─ main.tsx          浏览器入口
```

## 当前阶段边界

当前版本用于前后端效果确认，所有业务数据仍由 `src/features/**/**.mock.ts` 提供。Service 层保留异步接口形状，但尚未连接真实 API。后端对接入口请阅读 `BACKEND_HANDOFF.md`。

## 常见问题

### PowerShell 提示找不到 `npm`

Node.js 没有安装成功，或者新安装后终端尚未重启。关闭 PowerShell，重新打开后运行：

```powershell
node --version
npm --version
```

### 浏览器打不开本地地址

确认运行 `npm run dev` 的终端仍然开启，并使用终端实际显示的地址。终端停止后，本地网页也会停止。

### 修改文件后页面没有变化

先确认修改的是本工程 `src/` 内的文件，而不是上一级静态原型；然后检查终端和浏览器控制台是否出现红色报错。

### `npm run test` 失败

阅读第一段失败信息，通常会指出测试文件、行号和预期内容。不要只看末尾的 “failed”。
