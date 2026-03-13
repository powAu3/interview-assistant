# 🎙️ 智能面试学习辅助助手

实时语音转录 + AI 问答辅助 + 模拟练习自测，帮助你更高效地进行技术学习与面试准备。支持多种技术栈、编程语言和大模型切换。

<p align="center">
  <img src="https://img.shields.io/badge/license-CC%20BY--NC%204.0-blue" alt="License" />
  <img src="https://img.shields.io/badge/python-3.10+-green" alt="Python" />
  <img src="https://img.shields.io/badge/node-18+-orange" alt="Node" />
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows-lightgrey" alt="Platform" />
</p>

---

## ✨ 功能特性

| 功能 | 描述 |
|------|------|
| 🎤 实时语音转录 | 捕获系统/麦克风音频，本地 Whisper 模型实时转文字 |
| 🤖 AI 答案生成 | 对接 OpenAI 兼容 API，流式输出 Markdown 格式答案 |
| 🏋️ 模拟练习模式 | AI 出题 → 你回答 → 即时评价 → 综合报告，完整自测闭环 |
| 📄 简历感知 | 上传简历 PDF，AI 结合经历生成个性化内容 |
| 💬 多轮对话 | 保持上下文，支持追问和深入讨论 |
| 📷 截图识题 | Ctrl+V 粘贴截图，发送给支持视觉的 LLM 分析 |
| 🔄 多模型切换 | 配置文件定义多个 LLM，界面一键切换 |
| 🧠 Think 模式 | 支持 DeepSeek 等模型的深度思考模式 |
| 🖥️ 桌面模式 | 原生 GUI 窗口（pywebview），独立运行 |
| 🌐 网络模式 | 局域网共享，手机/平板扫码访问 |
| 📱 移动端适配 | 响应式布局，多端舒适使用 |
| 👻 Boss Key | Ctrl+B 一键隐藏窗口（含任务栏/Dock），系统托盘恢复 |

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
git clone <your-repo-url>
cd interview-assistant
```

### 第二步：安装后端依赖

```bash
# 创建虚拟环境（推荐）
python3 -m venv venv
source venv/bin/activate        # macOS / Linux
# venv\Scripts\activate          # Windows PowerShell
# venv\Scripts\activate.bat      # Windows CMD

# 安装依赖
pip install -r backend/requirements.txt
```

> **macOS 提示**: 如果 `sounddevice` 安装失败，先 `brew install portaudio`
>
> **Windows 提示**: 如果 `faster-whisper` 安装慢，可先装 CUDA 版 PyTorch 再安装

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

然后用编辑器打开 `backend/config.json`，填入你的 API Key。详细配置说明见下方「配置详解」章节。

### 第五步：启动

```bash
# 桌面模式（默认）— 原生 GUI 窗口
python start.py

# 网络模式 — 局域网设备可通过浏览器访问
python start.py --mode network

# 自定义端口
python start.py --port 8888

# 跳过前端构建（已经执行过 npm run build）
python start.py --no-build
```

---

## ⚙️ 配置详解

配置文件位于 `backend/config.json`。首次运行前需从模板复制：

```bash
cp backend/config.example.json backend/config.json
```

> ⚠️ `config.json` 包含 API Key 等敏感信息，已加入 `.gitignore`，**不会被提交到 Git**。仓库中只有 `config.example.json` 模板。

### 完整配置字段说明

```jsonc
{
  // ── 大模型配置 ────────────────────────────────────
  "models": [
    {
      "name": "GPT-4o",               // 界面显示名称（随便起）
      "api_base_url": "https://api.openai.com/v1",  // API 地址
      "api_key": "sk-your-key",        // API Key（必填）
      "model": "gpt-4o",              // 模型 ID（发给 API 的 model 参数）
      "supports_think": false,         // 是否支持 Think 深度思考模式
      "supports_vision": true          // 是否支持图片识别（多模态）
    }
  ],
  "active_model": 0,                  // 默认使用第几个模型（从 0 开始）
  "temperature": 0.7,                 // 生成温度 (0-2)，越高越有创造性
  "max_tokens": 4096,                 // 单次最大输出 token 数
  "think_mode": false,                // 是否启用 Think 模式（需模型支持）

  // ── 语音识别配置 ──────────────────────────────────
  "whisper_model": "base",            // Whisper 模型: tiny/base/small/medium
  "whisper_language": "zh",           // 识别语言: zh(中文), en(英文), ja(日文)...

  // ── 学习配置 ──────────────────────────────────────
  "position": "后端开发",              // 岗位: 前端开发/后端开发/算法工程师/测试开发
  "language": "Python",               // 编程语言: Python/Java/C++/JavaScript

  // ── 语音检测参数 ──────────────────────────────────
  "auto_detect": true,                // 自动识别语音并发送给 LLM
  "silence_threshold": 0.01,          // 静音阈值 (0-1)，环境噪音大可调高
  "silence_duration": 2.0             // 静音时长(秒)，说话停顿多久算结束
}
```

### 各种 LLM 配置示例

<details>
<summary><b>OpenAI (GPT-4o / GPT-4o-mini)</b></summary>

```json
{
  "name": "GPT-4o",
  "api_base_url": "https://api.openai.com/v1",
  "api_key": "sk-proj-xxxxxxxxxxxx",
  "model": "gpt-4o",
  "supports_think": false,
  "supports_vision": true
}
```
API Key 获取: https://platform.openai.com/api-keys
</details>

<details>
<summary><b>DeepSeek (V3 / R1)</b></summary>

```json
{
  "name": "DeepSeek-V3",
  "api_base_url": "https://api.deepseek.com",
  "api_key": "sk-xxxxxxxxxxxx",
  "model": "deepseek-chat",
  "supports_think": true,
  "supports_vision": false
}
```
API Key 获取: https://platform.deepseek.com/api_keys
</details>

<details>
<summary><b>通义千问 (Qwen)</b></summary>

```json
{
  "name": "Qwen-Plus",
  "api_base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
  "api_key": "sk-xxxxxxxxxxxx",
  "model": "qwen-plus",
  "supports_think": false,
  "supports_vision": true
}
```
API Key 获取: https://dashscope.console.aliyun.com/apiKey
</details>

<details>
<summary><b>本地部署 (Ollama)</b></summary>

```json
{
  "name": "Ollama-Qwen",
  "api_base_url": "http://localhost:11434/v1",
  "api_key": "ollama",
  "model": "qwen2.5:14b",
  "supports_think": false,
  "supports_vision": false
}
```
无需 API Key，`api_key` 随便填即可。先确保 Ollama 运行中: `ollama serve`
</details>

<details>
<summary><b>Claude (通过第三方兼容 API)</b></summary>

```json
{
  "name": "Claude-3.5-Sonnet",
  "api_base_url": "https://your-claude-proxy.com/v1",
  "api_key": "sk-xxxxxxxxxxxx",
  "model": "claude-3-5-sonnet-20241022",
  "supports_think": false,
  "supports_vision": true
}
```
需要使用兼容 OpenAI 格式的 Claude 代理服务。
</details>

### 配置多个模型

在 `models` 数组中添加多个模型，界面顶部会出现下拉选择器，可实时切换：

```json
{
  "models": [
    { "name": "GPT-4o", "api_base_url": "...", "api_key": "...", "model": "gpt-4o", "supports_think": false, "supports_vision": true },
    { "name": "DeepSeek", "api_base_url": "...", "api_key": "...", "model": "deepseek-chat", "supports_think": true, "supports_vision": false },
    { "name": "Ollama本地", "api_base_url": "http://localhost:11434/v1", "api_key": "x", "model": "qwen2.5:14b", "supports_think": false, "supports_vision": false }
  ],
  "active_model": 0
}
```

> - `supports_vision: true` 的模型在选择器中会标注 👁，表示支持截图识别
> - `supports_think: true` 的模型可以启用 Think 深度思考按钮
> - 对不支持视觉的模型粘贴图片时，会弹出提醒并自动降级为纯文字

---

## 🖥️ 两种运行模式

### 桌面模式（默认）

- 使用 **pywebview** 打开独立窗口（非浏览器）
- 服务绑定 `127.0.0.1`，仅本机可用
- **Boss Key**: `Ctrl+B`（macOS: `Cmd+B`）一键隐藏窗口，从任务栏/Dock 消失
- **系统托盘**: 隐藏后通过菜单栏/系统托盘图标"显示窗口"恢复

### 网络模式

- 绑定 `0.0.0.0`，同一局域网设备均可访问
- 终端显示局域网 IP 和二维码，手机/平板扫码即可使用
- 音频来源始终是运行服务端的主机

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

本工具可以捕获系统音频（如在线会议中对方的声音）。不同系统配置方式不同：

### macOS — BlackHole 虚拟音频设备

macOS 不允许直接录制系统输出音频，需要借助 **BlackHole** 虚拟音频设备。

**1. 安装 BlackHole**

```bash
brew install blackhole-2ch
```

> 如果没有 Homebrew，先安装：https://brew.sh

**2. 创建多输出设备**

1. 打开 **音频 MIDI 设置**（Spotlight 搜索 "Audio MIDI Setup"）
2. 左下角 **+** → **创建多输出设备**
3. 右侧勾选：✅ 你的扬声器/耳机 + ✅ **BlackHole 2ch**
4. 将 **主设备** 设为扬声器，勾选 BlackHole 的「漂移校正」

**3. 设置系统输出**

系统设置 → 声音 → 输出 → 选择刚创建的 **多输出设备**

**4. 在工具中选择设备**

选择 **BlackHole 2ch**（设备列表中带 ⟳ 标记、归类在"系统音频"下）

> 📖 详细图文教程：[macOS 使用 BlackHole 录制系统声音](https://zhuanlan.zhihu.com/p/667430079)
>
> 使用结束后，回到 系统设置 → 声音 → 输出 改回原来的扬声器即可。

---

### Windows — WASAPI Loopback

Windows 原生支持系统音频录制：

1. 在设备列表中选择带有 **WASAPI** 或 **Loopback / Stereo Mix** 标记的设备
2. 如果没看到：
   - 右键系统托盘 🔊 音量图标 → **声音设置**
   - 找到 **录制** 选项卡 → 右键空白处 → **显示已禁用的设备**
   - 找到 **立体声混音（Stereo Mix）** → 右键 → **启用**

## 🔧 其他功能说明

### 截图识题

在实时辅助模式下的输入框中 `Ctrl+V`（macOS: `Cmd+V`）粘贴剪贴板中的截图：

- 支持视觉的模型（带 👁 标记）会直接分析图片内容
- 不支持的模型会弹出提醒，图片被自动剥离，仅发送文字
- 可以截图 + 文字说明一起发送

### 简历上传

- 支持 PDF、TXT、Markdown 格式（最大 10MB）
- 上传后 AI 会参考简历中的项目经历生成更贴合个人背景的内容
- 在实时辅助模式底部控制栏点击「简历」按钮上传

### Whisper 语音识别

使用 [faster-whisper](https://github.com/SYSTRAN/faster-whisper) 本地运行，无需联网：

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
├── README.md
├── LICENSE                   # CC BY-NC 4.0
├── .gitignore
├── docs/
│   └── skm.png               # 赞赏码
├── backend/
│   ├── main.py               # FastAPI 主入口 + WebSocket
│   ├── config.py             # 配置管理 (Pydantic)
│   ├── config.example.json   # 配置模板（提交到 Git）
│   ├── audio_capture.py      # 跨平台音频捕获 + VAD
│   ├── stt_engine.py         # Whisper 语音识别引擎
│   ├── llm_service.py        # LLM API 调用 + 多模态处理
│   ├── practice_manager.py   # 模拟练习模式（出题/评价/报告）
│   ├── resume_parser.py      # 简历解析（PDF/TXT/MD）
│   ├── session_manager.py    # 会话管理 + 多轮对话
│   └── requirements.txt      # Python 依赖
└── frontend/
    ├── src/
    │   ├── App.tsx            # 主页面（模式切换 + 布局）
    │   ├── stores/            # Zustand 全局状态管理
    │   ├── hooks/             # WebSocket 连接 Hook
    │   ├── components/        # UI 组件
    │   │   ├── PracticeMode.tsx    # 模拟练习
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
| 音频捕获 | sounddevice (PortAudio) |
| LLM | OpenAI 兼容 API (GPT, DeepSeek, Qwen, Claude 等) |
| 通信 | WebSocket (实时推送) |
| 桌面 GUI | pywebview (原生窗口) + pystray (系统托盘) |
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

### 目录约定

- `frontend/src/components/` — React 组件
- `frontend/src/stores/` — Zustand store
- `frontend/src/hooks/` — React hooks
- `frontend/src/lib/` — 工具函数和 API 封装
- `@/` 是 `src/` 的路径别名（在 `vite.config.ts` 和 `tsconfig.json` 中配置）

---

## ❓ 常见问题

### Q: 启动报错 `npm: command not found`？

需要安装 Node.js 18+。推荐用 [nvm](https://github.com/nvm-sh/nvm) 管理：

```bash
nvm install 18
nvm use 18
```

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
