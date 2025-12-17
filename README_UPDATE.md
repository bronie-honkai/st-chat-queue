Chat Queue — 更新说明与快速升级步骤

说明

本次更新修复了扩展在某些 SillyTavern 部署中因相对 import 路径导致无法加载的问题。
主要改动：
- 删除对外部 import（script.js / utils.js）的静态依赖，改为使用 SillyTavern 暴露的全局变量（`Generate`, `eventSource`, `event_types` 等）。
- 内联了 `getBase64Async` 与 `getFileExtension` 两个工具函数。
- 增加了对 ST 全局对象就绪的轮询，避免在启动时因加载顺序导致的初始化中断。

快速升级（推荐：使用 git）

1. 在目标机器上进入扩展目录：

```bash
cd path/to/SillyTavern/public/scripts/extensions/third-party/st-chat-queue
```

2. 拉取最新代码：

```bash
git pull origin main
```

3. 刷新 SillyTavern 页面（浏览器按 Ctrl+F5 或重启服务）。

4. 在浏览器开发者工具 Console 中检查：

```javascript
typeof eventSource
typeof event_types
typeof Generate
document.querySelector('#attachment_queue_icon') !== null
```

如果前三项返回不是 "undefined"，且最后一项为 `true`，扩展应已可用。

手动更新（无 git 的情况）

1. 在 GitHub 上下载本扩展仓库的 ZIP（或 Release），解压替换你本地的 `third-party/st-chat-queue` 目录。
2. 刷新 SillyTavern 页面（Ctrl+F5）。

如果更新后仍然无效

- 清除浏览器缓存并强制刷新（Ctrl+F5）。
- 确认页面没有加载旧版本的 `index.js`（在 Network 面板中查找 `/scripts/extensions/third-party/st-chat-queue/index.js`，确认已加载的文件为最新日期/大小）。
- 在控制台抓取并提供错误信息（截图或粘贴文本），我来继续诊断。

关于自动更新（可选）

- 我已将一个可跟踪的 hooks 放到 `scripts/hooks/post-commit`，并提供安装脚本 `scripts/install-hooks.sh` 与 `scripts/install-hooks.ps1`。若你希望在每台测试机上自动拉取最新提交并重载扩展，需要在那些机器上运行安装脚本以启用本地钩子。

联络我

如果你希望我代为生成一份给测试者的邮件模板或整合到仓库 README，我可以立刻完成并提交到仓库。
