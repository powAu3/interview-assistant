# 🎙️ 智能面试学习辅助助手
ai辅助面试+模拟面试+简历优化
实时语音转录 + AI 问答辅助 + 模拟练习自测，帮助你更高效地进行技术学习与面试准备。支持多种技术栈、编程语言和大模型切换。

<p align="center">
  <img src="https://img.shields.io/badge/license-CC%20BY--NC%204.0-blue" alt="License" />
  <img src="https://img.shields.io/badge/python-3.10+-green" alt="Python" />
  <img src="https://img.shields.io/badge/node-18+-orange" alt="Node" />
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows-lightgrey" alt="Platform" />
</p>

---

## 📑 目录

- [界面预览](#-界面预览)
- [功能特性](#-功能特性)
- [架构](#-架构)
- [快速开始](#-快速开始)
- [详细文档](#-详细文档)
- [配置概览](#️-配置概览)
- [两种运行模式](#️-两种运行模式)
- [模拟练习模式](#️-模拟练习模式)
- [音频配置](#-音频配置)
- [其他功能说明](#-其他功能说明)
- [项目结构](#-项目结构)
- [技术栈](#️-技术栈)
- [开发指南](#-开发指南)
- [常见问题](#-常见问题)
- [开源协议](#-开源协议)
- [免责声明](#️-免责声明)
- [赞赏](#-赞赏)

---

## 📸 界面预览

| 实时辅助 | 模拟练习 |
|:---:|:---:|
| ![实时辅助](docs/screenshots/assist-mode.png) | ![模拟练习](docs/screenshots/practice-mode.png) |

| 能力分析 | 简历优化 |
|:---:|:---:|
| ![能力分析](docs/screenshots/knowledge-map.png) | ![简历优化](docs/screenshots/resume-optimizer.png) |

> 实时辅助模式下，输入框上方有快捷提示词标签，设置面板中可自定义；手机扫码需在设置面板底部查看二维码。

---

## ✨ 功能特性

| 功能 | 描述 |
|------|------|
| 🎤 实时语音转录 | 捕获系统/麦克风音频，本地 Whisper 模型实时转文字 |
| 🤖 AI 答案生成 | 对接 OpenAI 兼容 API，流式输出 Markdown 格式答案 |
| ⏸️ 暂停/继续 | 面试中随时暂停录音，不结束会话，继续时无缝衔接 |
| 🏋️ 模拟练习模式 | AI 出题 → 你回答 → 即时评价 → 综合报告，完整自测闭环 |
| 📄 简历感知 | 上传简历 PDF，AI 结合经历生成个性化内容 |
| 💬 多轮对话 | 保持上下文，支持追问和深入讨论 |
| 📷 截图识题 | Ctrl+V 粘贴截图，发送给支持视觉的 LLM 分析 |
| 🔄 多模型切换 | 配置文件定义多个 LLM，界面一键切换 |
| 🧠 Think 模式 | 支持 DeepSeek 等模型的深度思考模式 |
| 🖥️ 桌面模式 | Electron 原生窗口，屏幕共享隐身（Content Protection） |
| 🌐 网络模式 | 局域网共享，手机/平板扫码访问 |
| 📱 移动端适配 | 响应式布局，手机端专注实时辅助 |
| 👻 Boss Key | Ctrl+B 全局快捷键隐藏/显示窗口（任何时候都生效） |
| 🔒 屏幕共享隐身 | 窗口在屏幕共享和录屏中完全不可见 |
| 📌 窗口置顶 | 悬浮在其他窗口上方，随时可看 |
| 📊 能力分析 | 知识图谱追踪薄弱点，雷达图可视化，针对性复习出题 |
| 📝 简历优化 | 对比 JD 与简历，匹配度评分 + 修改建议 + 面试重点 |
| 📈 Token 统计 | 实时显示 LLM token 用量，掌握费用消耗 |
| 🔄 模型降级 | 主模型不可用时自动切换备用模型，保证流畅使用 |
| ⚡ 快捷提示词 | 输入框上方预设常用提示（写代码、给SQL、时间复杂度等），点击即填入，可在设置中自定义 |

## 📐 架构

```
┌────────────────┐     WebSocket      ┌──────────────────┐
│  React + Vite  │ ◄═══════════════► │   FastAPI Server  │
│  (前端 UI)      │                    │   (Python 后端)   │
└────────────────┘                    └─────┬────────────┘
                                            │
                           ┌────────────────┼────────────────┐
                           │                │                │
                    ┌──────▼──────┐  ┌──────▼──────┐  ┌─────▼─────┐
                    │ Audio       │  │ Whisper     │  │ LLM API   │
                    │ Capture     │  │ (STT)       │  │ (OpenAI)  │
                    │ sounddevice │  │ faster-     │  │ 兼容格式   │
                    └─────────────┘  │ whisper     │  └───────────┘
                                     └─────────────┘
```

---

## 📚 详细文档

配置与接入说明已拆分为独立文档，便于查阅：

| 文档 | 说明 |
|------|------|
| [配置说明](docs/配置说明.md) | config.json 字段说明、从哪里复制模板 |
| [API 密钥与模型](docs/API密钥与模型.md) | 各厂商 API Key 申请、OpenAI / DeepSeek / 通义 / 智谱 / Ollama 等配置示例 |
| [豆包语音识别](docs/豆包语音识别.md) | 豆包 ASR 开通、密钥与热词表配置（界面只做引擎切换） |
| [音频配置](docs/音频配置.md) | macOS BlackHole、Windows WASAPI / 立体声混音 |

---

## 🚀 快速开始

### 环境要求

| 依赖 | 最低版本 | 说明 |
|------|---------|------|
| Python | 3.10+ | 后端运行时 |
| Node.js | 18+ | 前端构建 |
| npm | 8+ | 随 Node.js 安装 |
| Git | — | 克隆仓库 |

### 第一步：克隆项目

```bash
git clone https://github.com/powAu3/interview-assistant.git
cd interview-assistant
```

### 第二步：安装后端依赖

```bash
# 创建虚拟环境（推荐）
python3 -m venv venv
source venv/bin/activate        # macOS / Linux
# venv\Scripts\activate          # Windows PowerShell
# venv\Scripts\activate.bat      # Windows CMD

# 安装依赖（根目录有快捷 requirements.txt，和 backend/requirements.txt 等价）
pip install -r requirements.txt
```

> **macOS 提示**: 如果 `sounddevice` 安装失败，先 `brew install portaudio`
>
> **Windows 提示**: 如果 `faster-whisper` 安装慢，可先装 CUDA 版 PyTorch 再安装。
> 另外强烈建议额外安装 `soundcard`，用于 WASAPI 原生系统音频采集（音质更好，不需要启用"立体声混音"）：
> ```bash
> pip install soundcard
> ```

### 第三步：安装前端依赖并构建

```bash
cd frontend
npm install
npm run build       # 构建生产版本到 frontend/dist/
cd ..
```

> 也可以跳过手动构建，启动脚本 `start.py` 会自动检测并构建。

### 第四步：配置

```bash
# 从模板创建本地配置文件
cp backend/config.example.json backend/config.json
```

然后用编辑器打开 `backend/config.json`，填入你的 API Key。详细说明见 [配置说明](docs/配置说明.md) 与 [API 密钥与模型](docs/API密钥与模型.md)。

### 第五步：启动

在项目根目录下（pyenv 会自动使用 `.python-version` 指定的 3.13.9）：

```bash
# 桌面模式（默认）— Electron 窗口，屏幕共享隐身
python start.py

# 快捷启动桌面模式（等价于 python start.py --mode desktop --no-build）
python quick-start.py

# 网络模式 — 局域网设备可通过浏览器访问
python start.py --mode network

# 自定义端口
python start.py --port 8888

# 跳过前端构建（已经执行过 npm run build）
python start.py --no-build
```

---

## ⚙️ 配置概览

配置文件：`backend/config.json`（从 `backend/config.example.json` 复制）。包含大模型、语音识别（Whisper / 豆包 ASR）、岗位/语言、VAD 等，详见：

- **[配置说明](docs/配置说明.md)** — 字段说明与模板
- **[API 密钥与模型](docs/API密钥与模型.md)** — 各厂商 API Key 申请与配置示例
- **[豆包语音识别](docs/豆包语音识别.md)** — 豆包 ASR 开通与热词表

---

## 🖥️ 两种运行模式

### 桌面模式（默认）

使用 **Electron** 原生窗口，推荐日常使用。

```bash
python start.py
```

**功能特性：**
- **屏幕共享隐身（Content Protection）**: 窗口在屏幕共享/录屏中完全不可见，对方看到的是黑色
- **Boss Key**: `Ctrl+B`（macOS: `Cmd+B`）全局快捷键，**即使窗口不在前台也能触发**隐藏/显示
- **系统托盘**: 右键菜单可切换 显示/隐藏、窗口置顶、屏幕共享隐身 等选项
- **窗口置顶**: 悬浮在其他窗口上方，随时可看答案

**关于 Electron 依赖：**

`start.py` 会在首次运行时**自动安装** Electron（`desktop/node_modules/electron`），无需手动操作。

如果自动安装失败（国内网络常见），可手动安装：

```bash
cd desktop
npm install
cd ..
python start.py --no-build
```

> **国内网络加速**：Electron 包体较大（约 100-200MB），国内下载可能很慢。可设置镜像：
> ```bash
> # Windows PowerShell
> $env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
> npm install   # 在 desktop/ 目录下执行
>
> # macOS / Linux
> ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/" npm install
> ```
> 或者在 `desktop/` 目录下创建 `.npmrc` 文件：
> ```
> electron_mirror=https://npmmirror.com/mirrors/electron/
> ```

> **Windows 补充**: 如果遇到 `Error: EPERM` 权限错误，尝试以管理员身份运行终端。

### 网络模式

绑定 `0.0.0.0`，同一局域网设备均可通过浏览器访问，适合手机/平板使用或不想装 Electron 的场景。

```bash
python start.py --mode network
```

- 终端显示局域网 IP；手机/平板打开页面后，在右上角设置面板中可扫描二维码访问
- 音频来源始终是运行服务端的主机（手机只负责查看结果）
- 无屏幕共享隐身等 Electron 专属功能

## 🏋️ 模拟练习模式

在顶部切换到「模拟练习」标签，进入自测模式：

1. **上传简历**（可选）— AI 会根据你的项目经历出题，更贴近真实场景
2. **选择出题数量** — 4 / 6 / 8 / 10 题可选
3. **开始练习** — AI 面试官生成由浅入深的题目（项目经历 → 技术基础 → 系统设计）
4. **回答问题** — 可以打字回答，也可以用麦克风语音输入（需选择麦克风设备）
5. **获得评价** — 每题即时打分（准确性/完整性/表达力/深度 各 10 分）+ 亮点/不足/参考思路
6. **下一题** — 逐题推进，也可以随时"提前结束"
7. **综合报告** — 全部答完后生成完整面试报告（综合评分/各维度总结/改进建议/通过建议）

## 🎧 音频配置

本工具可捕获系统音频（如会议对方声音）或麦克风。macOS 需 BlackHole 虚拟设备，Windows 可用 WASAPI 或立体声混音。详见 **[音频配置](docs/音频配置.md)**。

## 🔧 其他功能说明

### 暂停 / 继续录音

面试进行中可以随时**暂停**录音（不结束面试），方便应对突发情况（如需要思考、接听电话等）。

- 录制中：底部控制栏显示 **暂停**（黄色）和 **停止**（红色）两个按钮
- 点击暂停后：变为 **继续**（绿色），音频采集停止，但面试会话、转录历史、AI 对话上下文全部保留
- 点击继续：无缝恢复录音，之前的上下文不丢失
- 点击停止：结束整个面试会话

> **区别**：暂停 ≠ 停止。停止后需要重新开始面试，历史对话也会清空（除非先清空再开始）。

### 快捷提示词

输入框上方有一排常用提示词标签（如「写代码实现」「给SQL」「时间复杂度」「举个例子」等），点击即可填入输入框，支持追加到已有内容后。在设置面板中可自定义列表、增删顺序、恢复默认。

### 截图识题

在实时辅助模式下的输入框中 `Ctrl+V`（macOS: `Cmd+V`）粘贴剪贴板中的截图：

- 支持视觉的模型（带 👁 标记）会直接分析图片内容
- 不支持的模型会弹出提醒，图片被自动剥离，仅发送文字
- 可以截图 + 文字说明一起发送

### 简历上传

- 支持 **PDF、DOCX、DOC、TXT、Markdown** 格式（最大 10MB）
- 上传后 AI 会参考简历中的项目经历生成更贴合个人背景的内容
- 在实时辅助模式底部控制栏点击「简历」按钮上传，或在「简历优化」Tab 中直接上传
- **注意**: 纯图片格式的 PDF（如扫描件）无法提取文字，建议使用文字版 PDF 或 DOCX

### 语音识别 (STT)

支持 **Whisper（本地）** 或 **豆包 ASR（API）**，在设置中切换。豆包开通与热词表见 **[豆包语音识别](docs/豆包语音识别.md)**。

Whisper 使用 [faster-whisper](https://github.com/SYSTRAN/faster-whisper) 本地运行，无需联网：

| 模型 | 大小 | 速度 | 精度 | 适用场景 |
|------|------|------|------|---------|
| tiny | ~75MB | 极快 | 一般 | 快速测试 |
| base | ~150MB | 快 | 良好 | **推荐默认** |
| small | ~500MB | 中等 | 较好 | 高精度需求 |
| medium | ~1.5GB | 较慢 | 优秀 | 最高精度 |

首次启动自动下载模型。国内网络慢可设置镜像：

```bash
export HF_ENDPOINT=https://hf-mirror.com
```

### 静音检测参数

在设置面板中可调整：

- **静音阈值** (默认 0.01): 音量低于此值算"静音"。环境噪音大可调到 0.02-0.05
- **静音时长** (默认 2.5s): 连续静音超过此时长就认为说完了，开始转录。说话爱停顿可调到 3-4 秒

---

## 📁 项目结构

```
interview-assistant/
├── start.py                  # 一键启动脚本（桌面/网络模式）
├── quick-start.py            # 快捷启动桌面模式（等价于 start.py --mode desktop --no-build）
├── scripts/
│   └── e2e_test.py           # 端到端自测脚本（后端 API + 前端构建）
├── README.md
├── LICENSE                   # CC BY-NC 4.0
├── .gitignore
├── docs/
│   ├── 配置说明.md            # config 字段与模板
│   ├── API密钥与模型.md       # 各厂商 API Key 与配置示例
│   ├── 豆包语音识别.md        # 豆包 ASR 与热词表
│   ├── 音频配置.md            # macOS BlackHole / Windows 系统音频
│   ├── skm.png                # 赞赏码
│   └── screenshots/           # 界面截图
├── desktop/                  # Electron 桌面端
│   ├── main.js               # 主进程（窗口管理/托盘/全局快捷键）
│   ├── preload.js            # IPC 桥接
│   ├── icon.png              # 应用图标
│   └── package.json          # Electron 依赖
├── backend/
│   ├── main.py               # FastAPI 主入口（路由注册）
│   ├── core/                 # 核心层
│   │   ├── config.py         # 配置管理 (Pydantic)
│   │   └── session.py        # 会话管理 + 多轮对话
│   ├── services/             # 服务层
│   │   ├── audio.py          # 跨平台音频捕获 + VAD
│   │   ├── stt.py            # Whisper 语音识别引擎
│   │   ├── llm.py            # LLM API 调用 + 降级策略 + Token 统计
│   │   ├── practice.py       # 模拟练习（出题/评价/报告）
│   │   ├── resume.py         # 简历解析（PDF/DOCX/TXT/MD）
│   │   ├── knowledge.py      # 知识图谱服务（SQLite）
│   │   └── resume_optimizer.py # 简历优化 LLM 服务
│   ├── routes/               # 路由层
│   │   ├── ws.py             # WebSocket + 广播
│   │   ├── common.py         # 配置/设备/简历接口
│   │   ├── interview.py      # 面试辅助接口
│   │   ├── practice.py       # 练习模式接口
│   │   ├── knowledge.py      # 能力分析接口
│   │   └── resume_opt.py     # 简历优化接口
│   ├── config.example.json   # 配置模板（提交到 Git）
│   └── requirements.txt      # Python 依赖
└── frontend/
    ├── src/
    │   ├── App.tsx            # 主页面（模式切换 + 布局）
    │   ├── stores/            # Zustand 全局状态管理
    │   ├── hooks/             # WebSocket 连接 Hook
    │   ├── components/        # UI 组件
│   │   ├── PracticeMode.tsx    # 模拟练习
│   │   ├── KnowledgeMap.tsx    # 能力分析（雷达图）
│   │   ├── ResumeOptimizer.tsx # 简历优化
│   │   ├── TranscriptionPanel.tsx  # 实时转录
│   │   ├── AnswerPanel.tsx     # AI 答案
│   │   ├── ControlBar.tsx      # 底部控制栏
│   │   └── SettingsDrawer.tsx  # 设置面板
    │   └── lib/               # API 封装
    ├── index.html             # 入口 HTML
    ├── package.json           # 前端依赖
    ├── vite.config.ts         # Vite 构建配置
    ├── tsconfig.json          # TypeScript 配置
    ├── tailwind.config.js     # Tailwind CSS 主题
    └── postcss.config.js      # PostCSS 配置
```

## 🛠️ 技术栈

| 层 | 技术 |
|----|------|
| 后端 | Python 3.10+, FastAPI, uvicorn |
| 前端 | React 18, TypeScript, Vite, Tailwind CSS |
| 语音识别 | faster-whisper (本地, CTranslate2) |
| 音频捕获 | sounddevice (PortAudio) + soundcard (Windows WASAPI loopback) |
| LLM | OpenAI 兼容 API (GPT, DeepSeek, Qwen, Claude 等) |
| 通信 | WebSocket (实时推送) |
| 桌面 GUI | Electron (Content Protection, 全局快捷键, 系统托盘) |
| 状态管理 | Zustand |

## 🔨 开发指南

### 前端开发模式

开发时可以用 Vite 开发服务器，支持热更新：

```bash
cd frontend
npm run dev
# 默认 http://localhost:5173，API 请求代理到 localhost:18080
```

需要同时启动后端：

```bash
cd backend
python -m uvicorn main:app --host 127.0.0.1 --port 18080 --reload
```

### 前端构建

```bash
cd frontend
npm run build     # 输出到 frontend/dist/
```

构建产物会被后端 FastAPI 以静态文件形式托管，无需单独部署前端。

### 端到端自测

```bash
python scripts/e2e_test.py
```

会依次执行：前端构建（若 dist 不存在）、启动后端、验证 API 接口、访问前端页面。全部通过即表示核心流程正常。

### 目录约定

- `frontend/src/components/` — React 组件
- `frontend/src/stores/` — Zustand store
- `frontend/src/hooks/` — React hooks
- `frontend/src/lib/` — 工具函数和 API 封装
- `@/` 是 `src/` 的路径别名（在 `vite.config.ts` 和 `tsconfig.json` 中配置）

### 请勿提交的文件（开源协作）

以下内容已写入 `.gitignore`，**请勿**提交到仓库：

- `backend/config.json`、`backend/user_config.json`（含 API Key 等敏感信息）
- `.env`、`.env.*`（环境变量与密钥）
- 本地/临时文件：`*.log`、`tmp/`、`temp/`、`*.bak`、IDE 配置（`.vscode/`、`.idea/`）等

仅提交与功能、文档、构建相关的代码与配置；个人配置与一次性测试脚本不要入库。

---

## ❓ 常见问题

### Q: 启动报错 `npm: command not found`？

需要安装 Node.js 18+。推荐用 [nvm](https://github.com/nvm-sh/nvm) 管理：

```bash
nvm install 18
nvm use 18
```

### Q: 桌面模式首次启动很慢/卡在"安装 Electron 依赖"？

`start.py` 首次运行需要下载 Electron（约 100-200MB）。国内网络可能很慢，建议手动安装并设置镜像：

```bash
cd desktop

# Windows PowerShell
$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
npm install

# macOS / Linux
ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/" npm install

cd ..
python start.py --no-build
```

### Q: 桌面模式报错 `Error: cannot find module 'electron'`？

Electron 依赖未安装成功，手动安装：

```bash
cd desktop && npm install && cd ..
```

### Q: 桌面模式打开后是空白/黑屏？

通常是前端未构建。确认 `frontend/dist/` 目录存在：

```bash
cd frontend && npm run build && cd ..
python start.py --no-build
```

### Q: 网络模式和桌面模式有什么区别，选哪个？

| 场景 | 推荐模式 |
|------|---------|
| 日常使用，需要屏幕共享隐身 | 桌面模式 |
| 想在手机/平板查看 AI 答案 | 网络模式 |
| 不想装 Electron / 嫌麻烦 | 网络模式 |
| 需要 Boss Key 快捷键 | 桌面模式 |

### Q: `sounddevice` 安装失败？

macOS 需要先安装 PortAudio：`brew install portaudio`

### Q: 启动后 STT 显示"加载中"很久？

首次需要下载 Whisper 模型（base 约 150MB）。国内网络可设置镜像：

```bash
export HF_ENDPOINT=https://hf-mirror.com
python start.py
```

### Q: 端口被占用？

```bash
# 查看占用
lsof -i:18080
# 杀掉进程
lsof -ti:18080 | xargs kill -9
# 或换个端口
python start.py --port 9090
```

### Q: 前端修改后不生效？

需要重新构建：

```bash
cd frontend && npm run build && cd ..
python start.py --no-build   # 不会再次构建，直接用 dist/
```

或者删掉 `frontend/dist/` 后让 `start.py` 自动重建。

### Q: 支持哪些 LLM？

任何兼容 OpenAI Chat Completions API 格式的服务均可，包括：
- OpenAI (GPT-4o, GPT-4o-mini)
- DeepSeek (V3, R1)
- 通义千问 (Qwen)
- 智谱 GLM ([免费注册](https://www.bigmodel.cn/invite?icode=5a%2Fd%2FBU%2FqTgh%2Bj4UEb6OnX3uFJ1nZ0jLLgipQkYjpcA%3D))
- Claude (需通过兼容 API 代理)
- 本地部署 (Ollama, vLLM, LM Studio)

## 📜 开源协议

[CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/)

- ✅ 个人学习使用
- ✅ 非商业用途的分享和修改
- ❌ 商业用途

如需商业授权请联系作者。

## ⚠️ 免责声明

本项目仅供**个人学习交流和技术研究**使用。使用者应当遵守所在地区的法律法规，对使用本工具所产生的一切后果**自行承担责任**。作者不对因使用本工具而导致的任何直接或间接损失负责。

- 本工具不鼓励、不支持任何形式的学术不端或考试作弊行为
- 使用者应确保其使用场景符合相关平台的规则和条款
- 本项目的技术实现仅作为学习参考，请合理使用

## ☕ 赞赏

如果这个项目对你有帮助，欢迎请作者喝杯咖啡：

<p align="center">
  <img src="docs/skm.png" width="260" alt="赞赏码" />
</p>
