# 研知图后端

唯一有效的数据与 API 契约：[20260904_yanzhitu_ca_contract_v06.md](../md文档/20260904_yanzhitu_ca_contract_v06.md)。当前后端已实现 Zotero 命令行导入、Collection 导入接口、Paper、AnalysisJob、B 分析结果提交、Extraction、Suggestion 审核、正式 Concept/Method 查询和 Graph 基础接口。

## 快速运行

打开 Anaconda PowerShell，依次执行。

### 1. 激活环境并进入项目

```powershell
conda activate zotero
cd D:\Projects\AI
```

### 2. 安装依赖

首次运行或依赖变化后执行：

```powershell
python -m pip install -r backend\requirements.txt
```

### 3. 启动 Zotero

打开 Zotero 桌面软件并保持运行。也可以执行：

```powershell
& "C:\Program Files\Zotero\zotero.exe"
```

### 4. 导入10篇文献

先试读，不写数据库：

```powershell
python -m backend.import_zotero --dry-run --limit 10
```

确认数量正常后正式导入：

```powershell
python -m backend.import_zotero --limit 10
```

### 5. 启动后端

```powershell
python -m backend.api
```

保持窗口运行，在浏览器打开：

```text
http://127.0.0.1:8000/api/v1/papers
```

这里显示的是后端返回的真实 JSON 数据。停止后端时按 `Ctrl+C`。

建议审核接口示例：

```text
http://127.0.0.1:8000/api/v1/suggestions?status=pending
```

Zotero 连接和文件夹接口：

```text
http://127.0.0.1:8000/api/v1/zotero/status
http://127.0.0.1:8000/api/v1/zotero/collections
```

现有图形界面仍是假数据原型，尚未连接后端。详细运行说明、故障处理和开发顺序见 [RUNBOOK.md](./RUNBOOK.md)。

## 文件说明

状态说明：

- 已实现：当前可以运行。
- 占位：已经确定职责，但尚未编写功能，当前不会被程序调用。

### A 后端：`backend/`

| 文件 | 状态 | 作用 |
|---|---|---|
| `__init__.py` | 已实现 | 把 `backend` 标记为 Python 包。 |
| `api.py` | 已实现 | A 的 API 入口；处理 Zotero、Paper、AnalysisJob、审核和 Graph 请求。 |
| `models.py` | 已实现 | 定义 Zotero 导入使用的 Paper、Author 和 Attachment 数据对象。 |
| `schemas.py` | 已实现 | 定义 v06 沿用的分析、审核和 Graph 枚举及基础校验。 |
| `schema.sql` | 已实现 | 创建论文、作者、PDF、同步范围、分析、审核和 Graph 数据表。 |
| `database.py` | 已实现 | 建立数据库连接，并把 Zotero 文献写入研知图数据库。 |
| `zotero_service.py` | 已实现 | 通过 Pyzotero 读取 Zotero 本地 API。 |
| `import_zotero.py` | 已实现 | Zotero 导入命令入口。 |
| `zotero_import_service.py` | 已实现 | 读取 Collection、生成预览、按文件夹导入并保存同步范围；真实Collection与预览已验证。 |
| `paper_repository.py` | 已实现 | 查询 Paper，并按 v06 返回 `PaperAuthor`、分页和最新 ResearchOverview。 |
| `analysis_job_repository.py` | 已实现 | 创建、查询和取消 AnalysisJob。 |
| `analysis_service.py` | 已实现 | 校验和保存 B 的分析结果，生成 Extraction、Evidence 和 Suggestion。 |
| `review_service.py` | 已实现 | 查询、采纳和拒绝 Suggestion，处理多目标事务和 superseded。 |
| `graph_service.py` | 已实现 | 查询正式 Concept/Method、候选节点和 depth/maxNodes Graph。 |
| `test_v05_flow.py` | 已实现 | 验证提交、幂等、多选审核、延迟关系、Graph 和 superseded。 |
| `test_zotero_import.py` | 已实现 | 使用临时数据库和模拟 Zotero 验证 Collection 导入与同步。 |
| `academic_search.py` | 占位 | 后续接入外部学术检索，不属于 v0.1。 |
| `requirements.txt` | 已实现 | 安装项目内的 Pyzotero 及其依赖。 |
| `RUNBOOK.md` | 已实现 | 详细运行、故障处理和开发顺序。 |

### B AI：`ai/`

| 文件 | 状态 | 作用 |
|---|---|---|
| `__init__.py` | 已实现 | 把 `ai` 标记为 Python 包。 |
| `pipeline.py` | 占位 | B 的统一入口，组织一篇论文的完整分析流程。 |
| `document_parser.py` | 占位 | 把 PDF 转成章节和文本块。 |
| `extractor.py` | 占位 | 提取研究概览、概念、方法、发现和证据。 |
| `relation_analyzer.py` | 占位 | 识别节点之间的候选关系。 |
| `relevance.py` | 占位 | 判断新文献与已有图谱的相关性。 |
| `qa.py` | 占位 | 后续实现知识问答，不属于 v0.1。 |

### 其他目录

| 文件或目录 | 作用 |
|---|---|
| `pyzotero-main/` | Pyzotero 1.13.2 本地源码。 |
| `yzt-frontend-mockup/` | C 的 HTML、JavaScript 和界面原型。 |
| `md文档/20260904_yanzhitu_ca_contract_v06.md` | A、B、C 唯一有效的 v0.3 契约。 |
| `md文档/20260904_yanzhitu_development_manual_v01.md` | 分工、整体流程、运行方法和开发状态。 |
