# 研知图开发手册 v01

日期：2026-09-04  
开发基线：`20260904_yanzhitu_ca_contract_v06.md`

## 1. 状态标记

本文只记录当前工作区实际状态：

- **已开发**：已有可运行代码，并至少完成自动测试或实际运行验证。
- **部分开发**：已有部分代码，但完整流程尚未跑通。
- **未开发**：只有计划、界面示例或占位文件。
- **待实机验证**：自动测试通过，但尚未连接真实外部软件或真实数据验证。

## 2. 三人分工

| 负责人 | 负责范围 | 不负责 |
|---|---|---|
| A 后端 | Zotero接入、SQLite、稳定ID、API、AnalysisJob、审核事务、正式Graph | 不判断论文知识内容，不绘制前端页面 |
| B AI | PDF解析、ResearchOverview、Concept/Method/Finding/Evidence提取、候选匹配、关系分析 | 不维护第二个正式数据库，不直接向C提供数据 |
| C 前端 | 文件夹选择、文献和进度展示、建议审核、Graph可视化 | 不直接访问Zotero，不直接运行Python，不直接调用B |

唯一正式数据库由A管理。B只返回结构化结果，C只通过A的API读写数据。

```text
Zotero原始文献
      ↓
A读取并保存Paper
      ↓
A把论文交给B分析
      ↓
B向A提交结构化结果
      ↓
A保存Extraction、Evidence和Suggestion
      ↓
C读取并让用户审核
      ↓
A把采纳结果写入正式Graph
```

## 3. 系统模块与当前状态

### 3.1 A后端

| 模块 | 主要文件 | 当前状态 | 已验证范围 |
|---|---|---|---|
| Zotero本地读取 | `zotero_service.py` | 已开发 | 已从真实Zotero导入10篇文献 |
| 命令行导入 | `import_zotero.py` | 已开发 | 支持预览和最近修改前N篇导入 |
| Collection导入 | `zotero_import_service.py` | 已开发 | 真实Zotero连接、64个文件夹和小文件夹预览已验证；正式导入与同步通过模拟测试 |
| SQLite与表结构 | `database.py`、`schema.sql` | 已开发 | Paper、作者、附件、分析、审核和Graph表可自动建立 |
| Paper查询 | `paper_repository.py` | 已开发 | 列表和详情可返回真实数据库数据 |
| AnalysisJob | `analysis_job_repository.py` | 部分开发 | 创建、查询、取消已实现；尚未自动调用真实B |
| B结果接收 | `analysis_service.py` | 已开发 | 提交、幂等、Evidence和Suggestion保存已通过测试 |
| Suggestion审核 | `review_service.py` | 已开发 | 列表、详情、单条采纳拒绝、多目标事务、superseded已通过测试 |
| Graph | `graph_service.py` | 已开发基础版 | 正式节点、关系和depth/maxNodes查询已通过测试 |
| 作者公开接口 | 尚无实现文件 | 未开发 | v06有契约，当前API入口未实现 |
| 学术检索 | `academic_search.py` | 未开发 | 当前是占位文件 |

### 3.2 B分析模块

| 模块 | 主要文件 | 当前状态 |
|---|---|---|
| 统一分析入口 | `ai/pipeline.py` | 未开发，占位 |
| PDF解析 | `ai/document_parser.py` | 未开发，占位 |
| 概念、方法、发现和证据提取 | `ai/extractor.py` | 未开发，占位 |
| 关系分析 | `ai/relation_analyzer.py` | 未开发，占位 |
| 新论文相关性判断 | `ai/relevance.py` | 未开发，占位 |
| 知识问答 | `ai/qa.py` | 未开发，占位 |

当前测试中的B分析结果是构造的结构化测试数据，不代表真实AI分析已经完成。

### 3.3 C前端

| 模块 | 当前状态 |
|---|---|
| 论文列表和详情界面 | 有Mock，尚未完整连接A |
| Suggestion审核界面 | 有Mock，但仍需按v06字段连接真实API |
| Graph界面 | 有Mock，尚未完整连接真实Graph API |
| Zotero文件夹选择弹窗 | 未开发 |
| Zotero导入预览与结果 | 未开发 |
| 同步Zotero按钮 | 未连接A |
| AnalysisJob真实进度 | 未连接真实B任务 |

`20260831_yanzhitu_frontend_mock_preview_v01.html`只能证明页面和交互原型存在，不能证明C已经接入真实后端。

## 4. 第一次安装和启动

### 4.1 安装依赖

打开Anaconda PowerShell：

```powershell
conda activate zotero
cd D:\Projects\AI
python -m pip install -r backend\requirements.txt
```

依赖只需首次安装或`requirements.txt`变化后重新安装。

### 4.2 日常启动

```text
启动Zotero桌面软件
        ↓
激活zotero环境
        ↓
进入D:\Projects\AI
        ↓
运行python -m backend.api
        ↓
打开C前端
```

命令：

```powershell
conda activate zotero
cd D:\Projects\AI
python -m backend.api
```

A默认监听：

```text
http://127.0.0.1:8000
```

可先检查：

```text
http://127.0.0.1:8000/api/v1/zotero/status
http://127.0.0.1:8000/api/v1/papers
```

## 5. Zotero文献导入流程

### 5.1 当前可用的命令行流程

前端尚未接入时，可继续使用命令行。

预览最近修改的10篇受支持文献：

```powershell
python -m backend.import_zotero --dry-run --limit 10
```

正式导入：

```powershell
python -m backend.import_zotero --limit 10
```

实际流程：

```text
手动运行import_zotero
        ↓
A通过Pyzotero连接本地Zotero
        ↓
按dateModified倒序读取顶层条目
        ↓
过滤支持的文献类型
        ↓
读取元数据、作者、标签和PDF路径
        ↓
按Library ID＋Item Key去重
        ↓
写入SQLite
        ↓
前端调用GET /api/v1/papers展示
```

这里的10篇只是测试上限，不是研究主题筛选结果。

### 5.2 正式的Collection导入流程

正式产品不要求用户逐篇勾选论文，而是选择一个或多个Zotero文件夹。Zotero文件夹的正式名称是Collection。

#### 第一步：检查连接

C调用：

```http
GET /api/v1/zotero/status
```

`connected=true`后才能继续；为`false`时提示用户启动Zotero并开启本地通信。

#### 第二步：读取文件夹树

C调用：

```http
GET /api/v1/zotero/collections
```

A通过Pyzotero读取全部Collection。C根据`parentCollectionKey`展示树状结构，并根据`syncSelection`预选上次保存的同步范围。

用户可以：

- 选择整个文库；
- 选择一个文件夹；
- 同时选择多个文件夹；
- 决定是否包含子文件夹。

#### 第三步：生成导入预览

C调用：

```http
POST /api/v1/zotero/import-preview
```

请求示例：

```json
{
  "mode": "collections",
  "collectionKeys": ["ABC123", "DEF456"],
  "includeSubcollections": true
}
```

A读取文件夹内容并与SQLite比较，但此时不写数据库。C展示：

- 找到多少顶层条目；
- 多少篇可以导入；
- 多少篇将新增、更新或保持不变；
- 多少篇有PDF或缺少PDF；
- 多少条因为类型不支持而跳过。

#### 第四步：用户确认导入

C调用：

```http
POST /api/v1/zotero/import
```

请求示例：

```json
{
  "mode": "collections",
  "collectionKeys": ["ABC123", "DEF456"],
  "includeSubcollections": true,
  "saveAsSyncScope": true
}
```

A执行：

```text
展开选中的Collection
        ↓
读取各文件夹的顶层文献
        ↓
跨文件夹去重
        ↓
创建新Paper或更新原Paper
        ↓
保存作者、标签和PDF附件
        ↓
保存本次同步范围
        ↓
返回导入统计和Paper ID
```

同一文献位于多个Collection时只生成一条Paper。没有PDF的论文仍导入元数据，并计入`missingPdfCount`。

#### 第五步：刷新前端

导入成功后，C调用：

```http
GET /api/v1/papers?page=1&pageSize=20&sortBy=updatedAt&sortOrder=desc
```

C必须使用A返回的真实数据重新渲染，不继续使用Mock中的旧文献。

完整流程：

```text
用户启动Zotero和A
        ↓
C检查Zotero连接
        ↓
C读取并显示Collection树
        ↓
用户选择文件夹和子文件夹规则
        ↓
C请求导入预览
        ↓
用户核对数量并确认
        ↓
C请求A正式导入
        ↓
A通过Pyzotero读取并写入SQLite
        ↓
C重新读取Paper列表
```

### 5.3 后续同步

首次导入时若使用`saveAsSyncScope=true`，A保存选择范围。以后用户点击“同步Zotero”时，C调用：

```http
POST /api/v1/zotero/sync
```

A重新读取相同范围，新增新文献并更新修改过的文献。第一版不自动删除已经进入数据库的Paper，也不撤销相关Extraction、Suggestion或Graph。

## 6. 文献分析与审核流程

导入只建立Paper和PDF附件，不等于AI分析完成。

### 6.1 创建分析任务

C调用：

```http
POST /api/v1/papers/{paperId}/analysis-jobs
```

A创建AnalysisJob。同一论文同时只能有一个活动任务。

### 6.2 A调用B

目标流程：

```text
A取得Paper和PDF路径
        ↓
A调用B的pipeline
        ↓
B解析PDF
        ↓
B提取ResearchOverview
        ↓
B提取Concept、Method、Finding和Evidence
        ↓
B查询或生成匹配候选
        ↓
B分析候选关系
```

这一段目前未跑通，因为B的Python文件仍是占位，A也尚未自动调度真实B。

### 6.3 B提交结果

B完成后向A调用内部接口：

```http
POST /api/v1/internal/analysis-jobs/{jobId}/result
```

A校验并保存：

```text
Extraction
Evidence
ResolutionCandidate
Suggestion
RelationCandidate
```

该接收和保存逻辑已经开发并通过结构化测试。

### 6.4 用户审核

C读取：

```http
GET /api/v1/suggestions
GET /api/v1/suggestions/{suggestionId}
```

用户对单条建议执行：

```http
POST /api/v1/suggestions/{suggestionId}/accept
POST /api/v1/suggestions/{suggestionId}/reject
```

Concept和Method的一条resolve建议可以选择1至3个候选，最多一个New。A在一个事务中完成节点、基础关系、Extraction状态和Suggestion结果更新。

### 6.5 展示正式Graph

C调用：

```http
GET /api/v1/graph?focusNodeId={nodeId}&depth=2&maxNodes=30
```

Graph只返回审核通过的正式节点和关系，不返回pending、rejected或superseded建议。

## 7. 关键数据对象

| 对象 | 产生者 | 保存者 | 使用者 |
|---|---|---|---|
| Paper、Author、附件 | A从Zotero读取 | A | B、C |
| AnalysisJob | A | A | B、C |
| ResearchOverview | B提取 | A | C |
| Evidence | B提交原文和clientRef，A生成最终ID | A | C审核、Graph |
| Extraction | B提交内容，A生成最终ID | A | C |
| ResolutionCandidate | B提出，A校验并生成最终ID | A | C审核 |
| Suggestion | A根据B结果生成 | A | C审核 |
| 正式节点和关系 | A根据用户采纳结果创建 | A | C展示 |

## 8. 当前可实际验证的路径

### 8.1 已验证

- 真实Zotero最近修改文献可以通过命令行导入SQLite。
- 相同Zotero文献重复导入不会形成第二条Paper。
- v05/v06沿用的B结果提交、Suggestion多目标审核、superseded和Graph流程通过自动测试。
- Collection树、包含子文件夹、跨文件夹去重、导入预览、保存同步范围和同步通过模拟Zotero测试。
- 当前真实Zotero已返回64个Collection；`2. FindR`文件夹实际预览得到3篇可导入文献且3篇均有PDF。

### 8.2 尚未验证

- Collection确认导入和后续同步尚未对当前正式数据库执行，避免测试污染现有数据。
- C尚未调用Collection导入接口。
- A尚未自动调用真实B。
- B尚未对真实PDF产生符合v06的提交。
- Zotero到Graph的完整端到端流程尚未跑通。

## 9. 接下来的严格开发顺序

1. 用用户当前Zotero验证Collection列表、父子关系、预览、导入和同步。
2. C开发Collection选择弹窗，并接入5个Zotero接口和Paper列表。
3. B实现`document_parser.py`，先稳定取得一篇PDF的章节和原文块。
4. B实现`extractor.py`，先产生符合v06的ResearchOverview、Evidence和一条Concept建议。
5. B用`pipeline.py`组织单篇论文完整结果。
6. A把AnalysisJob与真实B调用接通，并按真实子任务更新progress。
7. C接入真实AnalysisJob、Extraction和Suggestion。
8. 跑通“一个Collection→一篇Paper→一次分析→一条审核→一个Graph节点”的最小端到端流程。
9. 最后再开发学术检索、相关性判断和知识问答。

学术检索和问答不应抢在最小端到端流程之前开发。

## 10. 完成标准

第一阶段完成必须同时满足：

```text
用户能在C选择真实Zotero Collection
        ↓
A能导入并显示真实Paper
        ↓
用户能启动一篇论文的真实B分析
        ↓
C能显示真实Evidence和候选
        ↓
用户能采纳或拒绝
        ↓
Graph能显示本次采纳产生的正式知识
```

只有界面、Mock、数据表或单独接口存在，都不能单独视为整个研知图已经完成。
