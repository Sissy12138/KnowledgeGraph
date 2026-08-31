# Evidence Candidate Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将概念/方法建议改为一段 Evidence 对应多个已有或新建候选的紧凑审核卡，并支持默认选择、多选、拒绝弹窗和批量跳过。

**Architecture:** 在现有 `Suggestion` 上增加可选候选与审核结果字段，以兼容发现和关系建议。纯函数负责默认候选、最多三项及重名转换；卡片只管理尚未提交的局部选择，页面和 Mock 服务负责持久化审核结果。

**Tech Stack:** React 19、TypeScript 6、Vitest、Testing Library、CSS

**Spec:** `docs/20260829_yanzhitu_evidence_candidate_review_design_v01.md`

## Global Constraints

- 仅修改 `D:\Claude\KG` 下的项目文件。
- 概念与方法候选严格分开。
- 默认阈值为 0.70，每张卡最多选择 3 项。
- 保持发现、关系、论文分组、三状态标签及 409 刷新兼容。
- 所有行为改动先写失败测试并观察预期失败。

---

### Task 1: 候选数据模型与选择规则

**Files:**
- Modify: `src/features/suggestions/suggestion.types.ts`
- Create: `src/features/suggestions/suggestion-resolution.ts`
- Create: `src/features/suggestions/suggestion-resolution.test.ts`

**Interfaces:**
- Produces: `ResolutionCandidate`、`ResolutionSelection`、`getDefaultCandidateIds(suggestion)`、`toggleCandidateSelection(ids, candidateId, 3)`、`resolveNewCandidateName(...)`。

- [ ] 写测试：最高置信度达到 0.70 时只默认选择最高项，低于阈值时为空。
- [ ] 运行该测试并确认因函数不存在而失败。
- [ ] 实现默认选择纯函数并运行测试通过。
- [ ] 写测试：第四个候选不能加入，但已选项可以取消。
- [ ] 运行并确认预期失败，随后实现并通过。
- [ ] 写测试：新候选规范名称与已有候选重名时返回已有候选 ID。
- [ ] 运行并确认预期失败，随后实现并通过。

### Task 2: Mock 契约与审核持久化

**Files:**
- Modify: `src/features/suggestions/suggestion.mock.ts`
- Modify: `src/features/suggestions/suggestion.service.ts`
- Modify: `src/features/suggestions/suggestion.service.test.ts`

**Interfaces:**
- Consumes: `ResolutionCandidate`、`ResolutionSelection`。
- Produces: `acceptSuggestion(id, { selections })` 和支持 `selectionsById` 的批量审核；返回的已采纳建议保存 `resolvedSelections`。

- [ ] 写失败测试：采纳概念建议时保存多个选择及操作类型。
- [ ] 为概念和方法 Mock 增加已有/新建候选。
- [ ] 扩展服务输入并实现选择校验与保存，使测试通过。
- [ ] 写失败测试：概念建议无选择或超过三项时返回 400。
- [ ] 实现校验并运行服务测试通过。

### Task 3: 紧凑候选卡与拒绝弹窗

**Files:**
- Modify: `src/features/suggestions/SuggestionReviewCard.tsx`
- Create: `src/features/suggestions/RejectSuggestionDialog.tsx`
- Modify: `src/features/suggestions/SuggestionReviewPage.test.tsx`
- Modify: `src/features/suggestions/SuggestionReviewPage.css`

**Interfaces:**
- Consumes: 候选选择纯函数。
- Produces: `onReview(suggestion, status, reviewComment, selections)` 回调。

- [ ] 写失败测试：候选横向按钮显示名称和百分比，最高项默认选中。
- [ ] 实现候选按钮与默认选择并通过测试。
- [ ] 写失败测试：最多选择三项、绿色圆形确认提交这些选择。
- [ ] 实现多选和确认按钮并通过测试。
- [ ] 写失败测试：红色圆形按钮打开可选原因弹窗，确认后进入拒绝状态。
- [ ] 实现弹窗并通过测试。
- [ ] 写失败测试：编辑新节点为已有名称时自动切换已有候选。
- [ ] 实现名称编辑与重名提示并通过测试。
- [ ] 调整 CSS 为紧凑、换行、可访问的圆形操作按钮。

### Task 4: 页面编排与批量默认审核

**Files:**
- Modify: `src/features/suggestions/SuggestionReviewPage.tsx`
- Modify: `src/features/suggestions/PaperReviewGroup.tsx`
- Modify: `src/features/suggestions/SuggestionTypeSection.tsx`
- Modify: `src/features/suggestions/BatchReviewDialog.tsx`
- Modify: `src/features/suggestions/SuggestionReviewPage.test.tsx`

**Interfaces:**
- Consumes: `getDefaultCandidateIds` 和 `selectionsById`。
- Produces: 批量请求中的实际提交数、跳过数和逐建议默认选择。

- [ ] 写失败测试：批量采纳只包含达到阈值的候选卡，并显示跳过数量。
- [ ] 实现论文级和模块级批量请求构建并通过测试。
- [ ] 更新单项审核编排，将选择提交给 Mock 服务。
- [ ] 更新历史页断言，确认已采纳卡展示多个解析结果。
- [ ] 运行审核模块全部测试。

### Task 5: 完整验证与页面检查

**Files:**
- Verify only: all changed files

**Interfaces:**
- Consumes: 完成后的审核功能。
- Produces: 测试、静态检查、构建和浏览器检查结果。

- [ ] 运行 `npm test`，预期全部通过。
- [ ] 运行 `npm run lint`，预期无错误。
- [ ] 运行 `npm run build`，预期成功生成生产构建。
- [ ] 在 `/review` 检查候选换行、默认选中、多选上限、拒绝弹窗和状态迁移。

