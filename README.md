# 大肥鱼桌宠 · BigFishPet

> ### ⚠️ 使用前必须先安装 `dsh-bigfish` 插件
>
> 这个桌宠**不打包任何角色素材**，宠物形象与动作全部来自本机已安装的 [dsh-bigfish](https://github.com/gosomea/dsh-bigfish) 插件。没装插件，程序能启动但**看不到宠物**。
>
> ```powershell
> dsh plugin --profile web add dsh-bigfish
> ```
>
> 装完重启 DeepSeek Harness，再看[第一节：前置要求](#一前置要求必须先装-dsh-和插件)。

把 [dsh-bigfish](https://github.com/gosomea/dsh-bigfish) 的宠物搬到一个**独立的 Electron 窗口**里：无边框、透明、可置顶、点空白处自动穿透，不占用 DeepSeek Harness 的窗口。

> **本仓库不包含任何角色美术素材。**
> 素材来自你自己机器上安装的 `dsh-bigfish` 插件，由程序在运行时读取。仓库里只有壳、启动器、构建脚本和文档。

---

## 一、前置要求（必须先装 DSH 和插件）

这个桌宠**不是**开箱即用的独立应用 —— 它需要本机已经装好 DeepSeek Harness（DSH）以及 `dsh-bigfish` 插件，因为角色美术和数据都在插件里。

### 1. 安装 DeepSeek Harness

按官方说明安装 DSH（桌面版或 `dsh` CLI 均可）。装好后至少启动过一次，确保存在以下目录：

```
C:\Users\<你>\.dsh\profiles\<profile>\node_modules\dsh-bigfish\
```

### 2. 安装 dsh-bigfish 插件

```powershell
# 装到 Web 界面用的 profile（把 web 换成你实际在用的 profile 名，如 desktop）
dsh plugin --profile web add dsh-bigfish
```

装完重启 Harness，右下角能看到宠物即算成功。

### 3. 验证插件位置

本程序按下面的顺序查找插件，找不到就会弹提示（不会白屏）：

| 顺序 | 路径 | 说明 |
| --- | --- | --- |
| 1 | `%BIGFISH_PLUGIN_DIR%` 环境变量 | 手动指定，方便调试 |
| 2 | `%USERPROFILE%\.dsh\profiles\desktop\node_modules\dsh-bigfish` | 桌面版默认 |
| 3 | `%USERPROFILE%\.dsh\profiles\web\node_modules\dsh-bigfish` | Web profile |
| 4 | `%USERPROFILE%\.dsh\profiles\*\node_modules\dsh-bigfish` | 其余 profile 兜底 |

---

## 二、素材是怎么读的

**仓库里没有 pet.html，也没有任何 PNG/DSPET。** 角色素材由主进程在启动时解析，按顺序尝试：

| 优先级 | 来源 | 内容 |
| --- | --- | --- |
| 1 | `BIGFISH_PET_ASSETS` 指定的目录 | 6 张 PNG（+ 可选 `playful.dshpet`） |
| 2 | 已安装插件的 `lib/client.js` | 6 个 `data:image/png;base64,…` + 1 个 `UEsDBB…`（13 MB 扩展包 base64） |
| 3 | 本地上游源码 `assets/sprites/*.png` | 6 张原始 PNG + `packs/playful/bundle.dshpet` |
| — | 都没有 | 弹窗说明如何安装插件，然后退出（不会白屏） |

读到的内容通过 preload 注入页面全局 `window.__BIGFISH_ASSETS__`，渲染层的 `sprite-assets` 从它取图，不再依赖构建期内联。

映射关系（**顺序固定，不要改**，详见 `docs/素材来源与读取.md`）：

```
bigfish-atlas.png    bigfish-motions.png   bigfish-signs.png
bigfish-work.png     bigfish-quiet.png     bigfish-daily.png
```

---

## 三、构建

```powershell
# 1) 安装壳的依赖
cd shell
npm ci

# 2) 生成 pet.html（从上游源码构建，产物不进仓库）
cd ..
pwsh -File scripts\build-pet.ps1

# 3) 打包（便携版 portable，输出到 ..\dist）
cd shell
npm run dist
```

`scripts\build-pet.ps1` 会做三件事：浅克隆上游 `dsh-bigfish` 到一个临时目录 → 跑上游的 `scripts/build-desktop.ts` → 把生成的 `pet.html` 放进 `shell\resources\`。

> 产物 `shell\resources\pet.html`、`dist\`、`node_modules\` 全部在 `.gitignore` 里，**不要提交**。

## 四、运行

```powershell
cd shell
npm start
```

| 操作 | 说明 |
| --- | --- |
| 左键托盘图标 | 显示 / 隐藏 |
| 右键托盘图标 | 置顶、自动演示、手动状态、重置位置、设置、退出 |
| 点宠物身体 | 交互（空白区域自动穿透到桌面） |
| 设置窗口 | 角色库、动作档位、台词、鞭策开关 |

## 五、内置 DeepSeek 对话（1.0.6 起）

桌宠带了一个可选的对话面板，用自己的 DeepSeek API Key 即可让宠物直接回答问题、必要时联网搜索。

| 项 | 说明 |
| --- | --- |
| 模型 | `deepseek-flash`（默认）、`deepseek-v4-pro` |
| API 地址 | `https://api.deepseek.com`，可用环境变量 `BIGFISH_DEEPSEEK_BASE` 覆盖 |
| Key 存放 | `%APPDATA%\BigFishPet\deepseek.json`，**经操作系统 `safeStorage` 加密后**存 base64，不落明文 |
| 日志 | 只记 `DEEPSEEK_KEY_SAVED` / `DEEPSEEK_KEY_DECRYPT_FAILED` 这类事件，**不打印 Key** |
| 联网范围 | 除 `api.deepseek.com` 外只做检索请求，不把 Key 发给第三方 |
| 未配置时 | 面板提示去设置里填 Key，宠物其余功能不受影响 |

IPC 侧做了来源校验（`trustedConfigSender`），只有主窗口和设置窗口能读写配置，第三方页面调不到。想彻底关掉对话功能，不填 Key 即可。

## 六、当前状态

| 项 | 状态 |
| --- | --- |
| Electron 壳（透明/置顶/穿透/托盘/设置） | ✅ 可用 |
| 便携版打包 + C# 启动器 | ✅ 可用 |
| 构建脚本（从上游生成 pet.html） | ✅ 可用 |
| **素材运行时读取（不再内嵌）** | ✅ 已实现（1.0.7 起） |

改造效果（同一台机器实测）：

| 项 | 改造前 | 改造后 |
| --- | --- | --- |
| `pet.html` | 34.61 MB（内联 6 张图集 + 扩展包） | **0.39 MB**（零内联） |
| `app.asar` | 34.88 MB | **0.68 MB** |
| 便携版 zip | 182 MB | **147 MB** |

zip 仍接近 150 MB，是因为 Electron 运行时本身占大头（解压后约 250 MB），这部分与素材无关。**关键是安装包里已经不含任何角色美术**，素材全部在运行时从插件读取。

## 七、许可与声明

- 本仓库代码：MIT（见 `LICENSE`）
- **角色美术**：归原权利人所有。`NOTICE` 保留了上游声明原文 —— *"The code MIT license does not license underlying third-party character rights."*
- 本程序只在本地读取用户已安装插件中的素材，**不随仓库或 Release 分发**。
- 若要商用或大规模分发，请自行取得素材权利人的授权。

## 八、常见问题

**双击没反应 / 一闪而过？**
看 `%APPDATA%\BigFishPet\` 下有没有日志；启动器会在 `bigfish-profile\` 里写 debug 日志。

**提示找不到插件？**
先按第一节装 `dsh-bigfish`，或用 `BIGFISH_PLUGIN_DIR` 直接指向插件目录再启动。

**SmartScreen 警告"未知发布者"？**
exe 未做代码签名，属正常现象。自用点"更多信息 → 仍要运行"。

**能不能反映我正在跑的任务？**
当前是演示模式（自动轮播 待机/思考/输出/工具执行/等待确认/完成）。接实时任务需要额外对接 DSH 会话接口，尚未实现。
