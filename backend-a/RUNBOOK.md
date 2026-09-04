# 研知图详细运行与开发手册

## 一、完整运行流程

下面所有命令都从 `D:\Projects\AI` 执行。

### 第一次运行

1. 打开 Anaconda PowerShell。
2. 激活项目使用的 Python 环境：

```powershell
conda activate zotero
cd D:\Projects\AI
```

3. 确认当前 Python 确实来自 `zotero` 环境：

```powershell
python -c "import sys; print(sys.executable)"
```

4. 安装依赖：

```powershell
python -m pip install -r backend\requirements.txt
```

5. 启动 Zotero 桌面软件并保持运行：

```powershell
& "C:\Program Files\Zotero\zotero.exe"
```

6. 验证 Zotero 本地接口：

```powershell
curl.exe -s http://127.0.0.1:23119/connector/ping
```

正常时会返回 Zotero 正在运行的信息。

7. 试读最近10篇支持的文献，不写数据库：

```powershell
python -m backend.import_zotero --dry-run --limit 10
```

8. 确认文献、作者和 PDF 数量正常后，正式导入：

```powershell
python -m backend.import_zotero --limit 10
```

9. 启动 A 后端：

```powershell
python -m backend.api
```

10. 保持后端窗口运行，在浏览器打开：

```text
http://127.0.0.1:8000/api/v1/papers
```

页面显示 JSON 说明“Zotero → 数据库 → A API”已经运行成功。停止后端时按 `Ctrl+C`。

### 以后再次运行

依赖已经安装且不需要重新导入文献时，只执行：

```powershell
conda activate zotero
cd D:\Projects\AI
python -m backend.api
```

然后打开：

```text
http://127.0.0.1:8000/api/v1/papers
```

只有需要从 Zotero 更新数据时，才需要打开 Zotero 并重新运行导入命令。

## 二、各部分具体说明

### 1. Python 环境和依赖

项目当前使用名为 `zotero` 的 Conda 环境。查看 Pyzotero 是否已安装：

```powershell
python -m pip show pyzotero
```

`backend/requirements.txt` 会从项目内的 `pyzotero-main/` 安装 Pyzotero，不会把 Python 包安装进 Zotero 软件本体。

### 2. Zotero 导入

数据流为：

```text
Zotero 本地 API → Paper / Author / Journal 元数据 → 研知图 SQLite 数据库
```

当前导入内容：

- 论文题名、摘要、日期、年份、DOI 和 URL；
- 作者及署名顺序；
- 期刊名称和 ISSN；
- Zotero 标签；
- 本地 PDF 路径；
- 每篇论文所属的全部 Zotero Collection。

Paper 列表和详情会返回 `hasPdf` 与 `zoteroCollections`。本机 PDF 绝对路径只保存在 A 的数据库中，不直接返回给 C。

笔记、批注、概念、方法和发现不从 Zotero 导入。概念、方法和发现后续由 B 分析论文产生。

常用命令：

```powershell
# 试读10篇，不写数据库
python -m backend.import_zotero --dry-run --limit 10

# 正式导入10篇
python -m backend.import_zotero --limit 10

# 导入全部支持的文献
python -m backend.import_zotero
```

默认数据库位置：

```text
backend/data/yanzhitu.sqlite3
```

若 Zotero 数据目录不是默认的 `%USERPROFILE%\Zotero`：

```powershell
python -m backend.import_zotero --zotero-root "你的Zotero数据目录" --limit 10
```

旧版直读和新版 Pyzotero 形成的10组重复文献已经清理，并已验证重复导入相同10篇后仍保持10篇。清理前备份位于 `backend/data/yanzhitu_before_dedup_20260830.sqlite3`。

### 3. A 后端 API

启动：

```powershell
python -m backend.api
```

默认地址：

```text
http://127.0.0.1:8000
```

当前接口：

```http
GET /api/v1/zotero/status
GET /api/v1/zotero/collections
POST /api/v1/zotero/import-preview
POST /api/v1/zotero/import
POST /api/v1/zotero/sync
GET /api/v1/papers?page=1&pageSize=20
GET /api/v1/papers/{paperId}
POST /api/v1/papers/{paperId}/analysis-jobs
GET /api/v1/analysis-jobs/{jobId}
POST /api/v1/analysis-jobs/{jobId}/cancel
POST /api/v1/internal/analysis-jobs/{jobId}/result
GET /api/v1/papers/{paperId}/extractions/latest
GET /api/v1/suggestions?status=pending
GET /api/v1/suggestions/{suggestionId}
POST /api/v1/suggestions/{suggestionId}/accept
POST /api/v1/suggestions/{suggestionId}/reject
GET /api/v1/concepts
GET /api/v1/methods
POST /api/v1/internal/node-match-candidates
GET /api/v1/graph?focusNodeId={nodeId}&depth=2&maxNodes=30
```

后端启动后会持续等待请求，不需要每点击一次按钮就重新运行 Python。

### 4. C 前端原型

现有 C 页面仍使用假数据，尚未调用 A API。若只想查看界面，另开一个 Anaconda PowerShell：

```powershell
conda activate zotero
cd D:\Projects\AI\yzt-frontend-mockup\yzt-frontend-mockup
python -m http.server 8420
```

浏览器打开：

```text
http://127.0.0.1:8420/yzt-frontend-mockup.html
```

这个页面能展示交互原型，但其中内容仍是假数据。A 的真实 JSON 当前位于 `http://127.0.0.1:8000/api/v1/papers`。

## 三、常见问题

### Zotero 导入长时间没有输出

先按 `Ctrl+C` 停止，再检查：

```powershell
curl.exe -s http://127.0.0.1:23119/connector/ping
```

如果没有返回结果：

1. 确认 Zotero 桌面软件已经启动；
2. 在 Zotero“设置 → 高级”中开启“允许本机上的其他应用程序与 Zotero 通信”；
3. 完全退出 Zotero 后重新启动。

### 提示没有安装 Pyzotero

确认已经激活正确环境，然后重新安装：

```powershell
conda activate zotero
cd D:\Projects\AI
python -m pip install -r backend\requirements.txt
```

### 浏览器只显示大量文字

`/api/v1/papers` 是后端数据接口，显示原始 JSON 是正常现象。最终图形界面需要 C 使用 JavaScript 调用这个接口并渲染数据。

## 四、开发顺序

唯一开发基线为 `md文档/20260904_yanzhitu_ca_contract_v06.md`。分工、端到端流程和准确开发状态见 `md文档/20260904_yanzhitu_development_manual_v01.md`。

已完成：

1. Zotero 接入、Collection 导入与同步接口、Paper 基础接口、重复导入保护。
2. AnalysisJob 创建、查询和取消。
3. 正式 Concept/Method 查询与内部候选查询。
4. B → A 结果提交、幂等校验、Evidence/Extraction 持久化。
5. Suggestion 列表、详情、单条采纳/拒绝、多目标原子事务和 superseded。
6. 正式 Graph、Author 节点、coAuthor 派生边以及 depth/maxNodes。

后续顺序：

1. 用真实 Zotero 验证 Collection 接口，并让 C 接入文件夹选择、预览、导入和 Paper 列表。
2. 把 B 的 `pipeline.py` 接到 AnalysisJob，产出真实分析结果。
3. 完成 Author provisional/merged、别名跳转和作者详情接口。
4. 让 C 的解析结果、审核和图谱页面切换到 A 的 v06 API。
