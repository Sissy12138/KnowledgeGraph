# 研知图协作仓库

本仓库按协作职责划分代码目录。前端、后端 A 和中端 B 在同一 Git 仓库中协作，通过各自目录减少日常改动冲突。

```text
frontend/       React + Vite 前端工程
backend-a/      后端 A 的服务代码
middleware-b/   中端 B 的数据处理层代码
docs/           接口契约、设计说明和协作文档
```

## 前端启动

在 PowerShell 中进入前端目录后运行：

```powershell
Set-Location .\frontend
npm ci
npm run dev
```

常用质量检查：

```powershell
npm run test
npm run test:preview
npm run lint
npm run build
```

前后端对接信息见 [BACKEND_HANDOFF.md](BACKEND_HANDOFF.md)，详细接口契约位于 `docs/backend/`。
