# Windows 空白便携版构建说明

当前 Windows x64 空白包使用项目的 `windows-app` 入口和 Electron 38.8.6 构建，复用此前便携版中的 Windows x64 Python 运行时。该便携包必须保留整个目录，不能只移动 `研知图.exe`。

在 Windows 入口文件中，空白版使用独立端口 `17841`、`17842`、`17843`，用户数据写入 `data-blank-v0.4.0`。内置数据库只包含表结构，论文、图谱节点和分析任务初始数量均为 0。模型配置文件同样保存在空白版的独立用户数据目录中。

在 macOS 上交叉构建 Windows 便携目录时，先准备含 `python.exe` 的 Windows x64 Python 运行时目录，设置环境变量 `YANZHITU_WIN_RUNTIME` 指向它，然后在 `desktop` 目录执行：

```bash
YANZHITU_WIN_RUNTIME=/path/to/windows-runtime npm run package:win:blank
```

构建后压缩 `desktop/dist-win-blank/win-unpacked` 整个目录。Windows 产物在 macOS 上只能做结构、版本号、SQLite 空库和 ZIP 完整性检查；正式发布前仍应在 Windows 10/11 真机测试启动、Zotero 接入和模型连接。

在 macOS 上已校验 PE32+ x64 文件、内置 Python x64、应用资源、SQLite 空库和 ZIP 完整性。Windows 程序不能在本机直接运行，仍需在 Windows 10/11 真机检查启动、Zotero 接入和模型连接。
