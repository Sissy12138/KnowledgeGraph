# 研知图（Research Knowledge Graph）

研知图是一款面向科研人员的本地文献知识管理与知识网络应用。它以 Zotero 文献库为入口，对论文进行结构化分析，在用户审核后形成概念、方法、作者合作和文献引用等多视角网络，并支持基于真实文献证据的知识问答。

当前版本：**0.4.0**（2026-09-29），两平台均提供空白数据版。

> 项目仍处于研究原型阶段。模型生成内容必须结合原文证据和人工审核使用，不应直接视为论文结论或事实判断。

## 核心能力

### Zotero 只读接入

- 读取 Zotero 本地文献库及文件夹，不修改 Zotero 原始数据。
- 支持按文件夹导入、重复导入识别和后续同步。
- 图谱可以按一个或多个 Zotero 文件夹过滤，也可以查看全部文献。

### 全文结构化分析

- 优先定位 Methods/Methodology；缺失时使用摘要、关键词导航和全文检索召回。
- 全文分批处理，不使用“前 14/16 个文本块”一类静默截断。
- 提取后统一去重，并复核概念、方法的名称边界和实体匹配。
- 每篇论文最多保留 6 个高价值概念和 6 个高价值方法，以控制噪声。
- 研究概览包括主题、研究问题、样本及分组、方法、主要结果和主要发现。

### 科研多视角图谱

- **概念网络**：结合论文内共现、跨论文关联、引用线索和模型二次关系判断。
- **方法网络**：展示方法实体及其关联概念、论文和方法间关系。
- **作者合作网络**：核心作者为一作、共同一作和通讯作者；桥接作者用于连接多个核心作者或表示强重复合作。
- **文献引用网络**：引用关系直接进入图谱，不要求人工审核。
- 支持相关作者、相关方法、相关概念和来源论文的上下文展开。

### 用户审核与重新分析

- 新概念、方法、发现和关系先进入建议审核，不会静默写入正式知识库。
- 已采纳内容可以重新打开考虑，也可以改为拒绝。
- 拒绝概念或方法时，自动拒绝依赖该实体的待审核关系。
- 成功论文可重新分析；当前默认使用新结果替换旧结果，避免重复节点。
- 失败或取消的任务支持单条重新执行和一键重新分析。

### 本地知识问答

- 检索题名、摘要、研究概览、概念、方法、主要发现和原文证据。
- 回答只依据本地已分析文献，并使用 `[1]`、`[2]` 等编号标注来源。
- 来源材料可展开查看并跳转到论文详情。
- 支持连续追问；问答为只读操作，不自动修改知识图谱。

## 版本下载

当前版本的 macOS、Windows 空白数据版、源代码归档和 SHA-256 校验文件整理在本地交付目录；上传 GitHub 后可从仓库的 Releases 页面下载：

- [GitHub Releases](https://github.com/Sissy12138/KnowledgeGraph/releases)

平台说明：

- macOS：Apple Silicon（arm64），提供空白数据版 DMG 和 ZIP。
- Windows：Windows 10/11 x64，提供空白数据版便携 ZIP。
- 两个平台的空白版均从 0 篇文献开始，使用独立的本机数据目录；随包不附带真实论文数据库。
- API Key 不包含在安装包或源代码中，需要用户在“模型配置”页面自行填写。

## 技术架构

```text
Zotero / PDF
    │
    ▼
Python 本地后端（文献、任务、审核、图谱、问答 API）
    ├── 中端分析流水线（全文分批提取、实体规范化、关系候选）
    ├── SQLite 本地数据库
    └── 用户配置的大模型 API
    │
    ▼
React + TypeScript + ECharts 前端
    │
    ▼
Electron 桌面应用（macOS / Windows）
```

主要目录：

```text
frontend/       React、TypeScript、Vite 前端
backend-a/      Python 本地 API、数据库和业务服务
backend/        backend-a 的兼容包入口
middleware-b/   全文分析、实体规范化和关系候选流水线
desktop/        Electron 桌面端与 macOS 自包含打包配置
docs/           契约、设计、更新日志和使用说明
scripts/        开发与打包辅助脚本
```

## 本地开发

环境要求：Node.js 20+、Python 3.12+、npm。

```bash
# 前端
cd frontend
npm ci

# 后端（回到仓库根目录）
python -m venv .venv
source .venv/bin/activate
python -m pip install -r backend-a/requirements.txt
python -m backend.api --database ./local-data/yanzhitu.sqlite3 --host 127.0.0.1 --port 8000

# 另一个终端启动前端
cd frontend
VITE_DATA_MODE=api npm run dev
```

Windows PowerShell 使用 `.\.venv\Scripts\Activate.ps1` 激活虚拟环境。开发页面默认为 `http://127.0.0.1:5173`。

## 测试与构建

```bash
cd frontend
npm test
VITE_DATA_MODE=api npm run build

cd ..
python -m unittest discover -s backend-a -t .
python -m unittest discover -s middleware-b -t .

cd desktop
npm ci
npm run package:mac
```

桌面安装包需要先准备对应平台的本地 Python 服务运行时。发布附件中已经包含运行所需文件。开发者自行构建 macOS 空白版时，先从仓库根目录生成空白数据库，再在 `desktop` 目录运行打包命令：

```bash
python -c "from pathlib import Path; from backend.database import connect; c=connect(Path('desktop/seed-data/yanzhitu-blank.sqlite3')); c.close()"
cd desktop
npm run package:mac:blank
```

Windows 便携版沿用已有的 Windows Electron 与 Python 运行时，更新前端、后端和空白数据库后封装；具体说明见 [Windows 空白版构建说明](desktop/Windows-空白版构建说明.md)。

## 模型配置与隐私

- API Key 只保存在当前用户的本机应用数据目录，不写入 Git、安装包或内置数据库。
- 文献数据库默认保存在本机，不会自动上传到 GitHub。
- 调用外部模型时，只发送完成当前分析或问答所需的文本片段。
- 发布前应检查 `.env`、模型配置、数据库和日志，避免提交凭据或个人文献数据。

## 当前限制

- macOS 包为本地签名版本，未经过 Apple Developer 公证；首次打开可能需要右键选择“打开”。
- Windows 便携版没有 Authenticode 签名，首次运行可能触发 SmartScreen。
- 跨论文关系和模型问答仍受 PDF 解析质量及模型能力影响，需要人工核对。
- Windows 产物在 macOS 上只能做结构与资源完整性校验，正式使用前建议进行 Windows 10/11 真机验收。

## 文档

- [0.4.0 更新日志](docs/更新日志-0.4.0.md)
- [0.4.0 使用说明](docs/使用说明-0.4.0.md)
- [后端运行手册](backend-a/RUNBOOK.md)
- [接口契约与设计文档](docs/backend/)

## License

当前仓库尚未附加开源许可证。除非仓库所有者另行声明，代码和发布文件不自动获得开源授权。
