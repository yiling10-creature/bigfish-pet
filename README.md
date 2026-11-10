# 大肥鱼普通对话版

独立的 Windows Electron 桌宠，保留普通 AI 对话、流式输出、停止、重试、联网搜索、按服务商保存的聊天记录和长期记忆。

本分支已删除人设目录、编辑器、新增、保存、切换及对应 IPC/API。使用空白人设：普通聊天不注入身份或风格 system 提示词，不包含角色身份、语言风格、动作描写或篇幅限制。桌宠美术外观与聊天身份独立。

支持 DeepSeek、智谱、千问、Kimi。用户自行在设置 → 问答配置 API Key；仓库不提供密钥。正常聊天及记忆整理会调用所选服务商。

## 素材

仓库不分发角色美术。运行前需要本机已安装 dsh-bigfish 插件，或用 BIGFISH_PLUGIN_DIR 指定安装位置。程序运行时读取插件素材。代码采用 MIT；角色素材及第三方组件遵循各自许可，详见 NOTICE。

## 开发

需要 Windows、Node.js 22.19+ 或 24+、pnpm，以及构建启动器所需的 .NET Framework 编译器。

```powershell
cd desktop
pnpm install --frozen-lockfile
pnpm check
pnpm test
pnpm build
cd ../shell
npm ci
npm test
npm start
```

完整构建：在仓库根目录执行 `pwsh -File scripts/build-package.ps1`。

实际窗口离线检查：安装 shell 依赖后，在 desktop 中执行 `node scripts/test-electron.cjs`。

## 独立资料

默认使用 %APPDATA%/BigFishChat；回退目录为 ~/.bigfish-chat。不会自动导入原版的 API 配置和聊天。记忆位于源目录 memory/（打包后为程序旁 repo/memory/）。这些运行资料均不应提交。

## 隐私与发布

仓库不含角色动画图集、原项目个人配置、密钥、聊天记录和长期记忆。运行中产生的资料、依赖及构建产物已通过 .gitignore 排除。提交前请检查暂存内容。

测试范围和尚未完成的验证见 [VALIDATION.md](VALIDATION.md)。
