# 研知图前端第一版：后端交付索引

## 快速查看效果

- 无需开发环境：双击 `frontend/preview/20260831_yanzhitu_frontend_mock_preview_v01.html`。
- 完整开发模式：进入 `frontend/` 后运行 `npm ci`，再运行 `npm run dev`。
- 当前页面数据全部来自 Mock，不会向真实服务写入数据。

## Mock 数据与接口形状

| 模块 | Mock 数据 | 类型定义 | Service 边界 |
| --- | --- | --- | --- |
| 文献 | `frontend/src/features/papers/paper.mock.ts`、`paper-detail.mock.ts` | `paper.types.ts` | `paper.service.ts` |
| 知识图谱 | `frontend/src/features/graph/graph.mock.ts` | `graph.types.ts` | `graph.service.ts` |
| 证据候选审核 | `frontend/src/features/suggestions/suggestion.mock.ts` | `suggestion.types.ts` | `suggestion.service.ts` |
| 分析任务 | `frontend/src/features/analysis/analysis-job.mock.ts` | `analysis-job.types.ts` | `analysis-job.service.ts` |

这些 Service 是前端未来替换为真实 API 的主要边界。后端可优先依据类型定义和测试确认字段、状态与错误行为。

## 后端契约与阻塞点

- `docs/backend/20260830_yanzhitu_ca_contract_v03_a_alignment_blockers_v01.md`
- `docs/backend/20260830_yanzhitu_backend_author_identity_contract_issue_v01.md`

其中统一记录了 `author_id`、概念/方法匹配状态、JIF/JCR 授权及旧契约冲突等待确认事项。

## 质量检查

```powershell
Set-Location .\frontend
npm run test
npm run test:preview
npm run lint
npm run build
```

`npm run test:preview` 会重新生成离线 HTML，并验证最终文件没有外部 CSS、JavaScript 或构建资源依赖。

## 当前限制

- Mock 行为用于展示交互，不代表最终数据库内容。
- 审核、重试和状态变化只保存在当前浏览器会话中。
- 离线 HTML 适合效果确认；正式联调仍应使用开发服务器和真实 API 环境。
