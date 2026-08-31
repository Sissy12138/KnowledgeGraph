# 研知图概念关系图上下文图层 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在概念关系图中实现一致的动态图例、一阶邻接聚焦，以及可切换的相关作者和相关方法上下文图层。

**Architecture:** 主图与派生上下文在 `GraphDataset` 中分离；`graph-transform` 根据概念焦点和两个开关计算当前可见节点、边、动态分类和透明度。React 页面保存概念焦点与开关状态，独立的画布悬浮控件只负责切换，不直接访问 Mock。

**Tech Stack:** React 19、TypeScript 6、ECharts 6、Vitest、Testing Library、CSS。

**Spec:** `docs/superpowers/specs/20260830_yanzhitu_concept_graph_context_overlay_design_v01.md`

## Global Constraints

- 所有修改只发生在当前已授权项目目录内。
- 使用 Windows PowerShell，Node 命令使用 `npm.cmd` 和 `npx.cmd`。
- 严格测试先行：每项行为先观察 RED，再写最小实现得到 GREEN。
- 组件不得直接导入具体 Mock，统一消费 `GraphDataset`。
- 派生上下文关系不写回正式图谱，也不进入建议审核。
- 作者上下文不得使用姓名匹配身份；当前只使用稳定 Mock 节点 ID 与论文 ID 交集。
- 当前目录不是 Git 仓库，不执行 commit；测试通过作为检查点。

---

### Task 1: 扩展上下文数据契约和 Mock

**Files:**
- Modify: `src/features/graph/graph.types.ts`
- Modify: `src/features/graph/graph.mock.ts`
- Modify: `src/features/graph/graph.service.ts`
- Test: `src/features/graph/graph.service.test.ts`

**Interfaces:**
- Produces: `GraphContextOverlay`。
- Produces: `GraphDataset.contextOverlay`。
- Produces: `GraphEdge.relationType` 新增 `conceptAuthor | conceptMethod`。

- [ ] **Step 1:** 在服务测试加入概念上下文断言：包含作者、方法节点；每条派生边端点存在；`sourcePaperIds` 是概念和上下文节点论文集合的非空交集。
- [ ] **Step 2:** 运行 `npx.cmd vitest run src/features/graph/graph.service.test.ts`，确认因 `contextOverlay` 不存在而失败。
- [ ] **Step 3:** 定义 `GraphContextOverlay`，为所有数据集和空态补齐该字段；概念 Mock 使用共享作者/方法节点的稳定 ID 构造派生边。
- [ ] **Step 4:** 运行数据服务测试，确认 GREEN。

### Task 2: 实现动态可见图、图例颜色和邻接聚焦

**Files:**
- Modify: `src/features/graph/graph-transform.ts`
- Test: `src/features/graph/graph-transform.test.ts`

**Interfaces:**
- Extend: `GraphPresentation.contextConceptId: string | null`。
- Extend: `GraphPresentation.showRelatedAuthors: boolean`。
- Extend: `GraphPresentation.showRelatedMethods: boolean`。
- Produces: `getVisibleGraph(dataset, presentation)` 的内部纯计算结果。

- [ ] **Step 1:** 增加失败测试，覆盖默认概念图只有概念图例且颜色一致、选中概念的一阶邻居不淡化、其他概念为 `0.18`、作者/方法开关的节点与边过滤、两个开关同时开启、切换概念替换上下文。
- [ ] **Step 2:** 运行 `npx.cmd vitest run src/features/graph/graph-transform.test.ts`，确认 RED。
- [ ] **Step 3:** 用单一 `NODE_PRESENTATION` 映射同时生成 categories、legend 和节点颜色；按上下文边筛选可见节点/边并计算焦点集合。
- [ ] **Step 4:** `buildGraphOption` 与 `buildGraphPresentationOption` 都返回动态 data、links、categories 和 legend；派生边使用虚线。
- [ ] **Step 5:** 运行转换测试，确认 GREEN。

### Task 3: 增加画布左下角上下文控件

**Files:**
- Create: `src/features/graph/GraphOverlayControls.tsx`
- Create: `src/features/graph/GraphOverlayControls.test.tsx`
- Modify: `src/features/graph/GraphPage.css`

**Interfaces:**
- Consumes: `showRelatedAuthors`、`showRelatedMethods`。
- Produces: `onShowRelatedAuthorsChange(next)`、`onShowRelatedMethodsChange(next)`。

- [ ] **Step 1:** 写失败测试，断言两个按钮文本、`aria-pressed` 和切换回调布尔值。
- [ ] **Step 2:** 运行 `npx.cmd vitest run src/features/graph/GraphOverlayControls.test.tsx`，确认组件不存在而 RED。
- [ ] **Step 3:** 实现命名区域和两个受控按钮。
- [ ] **Step 4:** CSS 将控件绝对定位到 `.graph-page__canvas` 左下角，使用 token、紧凑尺寸和清晰开关态。
- [ ] **Step 5:** 运行控件测试，确认 GREEN。

### Task 4: 页面与画布集成

**Files:**
- Modify: `src/features/graph/GraphCanvas.tsx`
- Modify: `src/features/graph/GraphCanvas.test.tsx`
- Modify: `src/features/graph/GraphPage.tsx`
- Modify: `src/features/graph/GraphPage.test.tsx`

**Interfaces:**
- Extend `GraphCanvasProps` with `contextConceptId`、`showRelatedAuthors`、`showRelatedMethods`。
- GraphPage owns context toggle state and last focused concept ID.

- [ ] **Step 1:** 扩展画布测试，确认三个新展示参数传入完整/合并选项，并且可访问名称反映可见节点和关系数量。
- [ ] **Step 2:** 扩展页面测试：控件仅在概念视图显示；默认关闭；点击后参数变化；选择上下文节点不丢失概念焦点；选择新概念更新焦点；重置清除焦点但保留开关。
- [ ] **Step 3:** 运行 `npx.cmd vitest run src/features/graph/GraphCanvas.test.tsx src/features/graph/GraphPage.test.tsx`，确认 RED。
- [ ] **Step 4:** GraphCanvas 构造扩展后的 `GraphPresentation`；GraphPage 区分主概念选择与上下文选择，并渲染 `GraphOverlayControls`。
- [ ] **Step 5:** 运行专项测试，确认 GREEN。

### Task 5: 完整验证和浏览器验收

**Files:**
- Modify only if a reproduced defect requires a TDD fix: files listed in Tasks 1–4.

- [ ] **Step 1:** 运行 `npm.cmd test`，要求 0 failed。
- [ ] **Step 2:** 运行 `npm.cmd run lint`，要求 0 error。
- [ ] **Step 3:** 运行 `npm.cmd run build`，要求退出码 0。
- [ ] **Step 4:** 浏览器验证默认图例、颜色一致性、一阶邻接淡化、作者/方法单独与同时开启、概念切换、控件位置、其他视图无控件及控制台无异常。
- [ ] **Step 5:** 若发现缺陷，先写失败测试，再做最小修复并完整回归。

