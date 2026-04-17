# 智能面试学习辅助助手

实时听题，自动生成专业面试回答。你可以把它理解成一个开着就能用的面试辅助工具：你负责听题、追问和临场反应，它负责转写、答题、截图审题，卡壳的时候还能把问答框挂在旁边。
面向真实技术面试场景：支持系统音频 / 麦克风转写、手动追问、截图审题、多模型切换；Electron 端提供共享隐身、Boss Key、托盘和轻量悬浮窗，绝大多数面试软件场景下都能避开屏幕共享检测。

![AI 实时辅助演示](docs/screenshots/assist-demo.gif)

<p align="center">
  <img src="https://img.shields.io/badge/license-CC%20BY--NC%204.0-blue" alt="License" />
  <img src="https://img.shields.io/badge/python-3.10+-green" alt="Python" />
  <img src="https://img.shields.io/badge/node-18+-orange" alt="Node" />
  <img src="https://img.shields.io/badge/react-18-61dafb" alt="React" />
  <img src="https://img.shields.io/badge/fastapi-0.100+-009688" alt="FastAPI" />
</p>

## 为什么值得试

- **实时转写**：采集系统音频或麦克风，把面试过程稳定转成文字。
- **自动答题 + 手动追问**：识别到问题后直接生成回答，也可以临时补一句“写代码实现”继续追问。
- **截图审题**：支持粘贴截图，把题目、代码或页面内容直接交给模型分析。
- **多模型协同**：支持 OpenAI 兼容接口、优先模型、并行路数、自动降级、Think 与识图。
- **桌面辅助更顺手**：Electron 端支持共享隐身、`Ctrl/Command + B` Boss Key、托盘和悬浮问答框。
- **界面随你收放**：默认 VSCode Light+ 主题，提供 Dark+/高对比/Nord/Solarized Dark 等多套方案；主页左侧实时转录面板可 `⌘⇧J / Ctrl+Shift+J` 一键折叠，把空间让给回答区。
- **不只是答题**：还带求职看板、能力分析、简历优化和模拟练习。

## 核心流程

1. 选择系统音频或麦克风。
2. 点击开始，实时转写面试内容。
3. 识别到问题后自动生成回答。
4. 需要时手动追问、补一句“写代码实现”、或直接截图审题。
5. 如果不想一直盯主界面，可以打开悬浮问答框，把最近的问题和答案挂在旁边。
6. 空间紧张时可以用 `⌘⇧J / Ctrl+Shift+J` 折叠左侧实时转录面板，回答区自动铺满。

静态界面预览：

![实时辅助主界面](docs/screenshots/assist-mode.png)

## 功能总览

| 模块 | 说明 |
|------|------|
| **实时辅助** | ASR 转写 → 自动识别问题 → 多模型并行生成回答 → 手动追问 / 截图审题 |
| **模拟练习** | AI 面试官出题、逐题评价、生成练习报告 |
| **求职看板** | 投递进度看板（表格 / Kanban）、拖拽排序、Offer 对比、状态色彩标签 |
| **能力分析** | 知识点 / 薄弱点沉淀、历史问答记录 |
| **简历优化** | 上传简历，对照 JD 输出修改建议 |
| **设置中心** | 多模型管理、STT 引擎切换、快捷键、偏好配置 |

## 架构

```
┌─────────────────────────────────────────────────────────────────┐
│                      start.py (统一入口)                         │
│          安装依赖 → 构建前端 → 启动后端 → (可选)启动 Electron      │
└────────────┬────────────────────────────┬───────────────────────┘
             │                            │
             ▼                            ▼
┌─────────────────────┐      ┌─────────────────────────┐
│   desktop/ (Electron)│      │    浏览器直接访问         │
│   main.js + preload  │      │    http://localhost:18080│
│   窗口 · 托盘 · 快捷键 │      └────────────┬────────────┘
└──────────┬──────────┘                     │
           │        ┌───────────────────────┘
           ▼        ▼
┌──────────────────────────────────────────────────────────────┐
│                 frontend/ (React + Vite + Zustand)            │
│                                                              │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────────────┐  │
│  │实时辅助   │ │模拟练习   │ │求职看板   │ │能力分析/简历优化│  │
│  │Answer +  │ │Practice  │ │Kanban +  │ │KnowledgeMap +  │  │
│  │Control + │ │Mode      │ │Table +   │ │ResumeOptimizer │  │
│  │Transcrip.│ │          │ │Offer对比  │ │                │  │
│  └──────────┘ └──────────┘ └──────────┘ └────────────────┘  │
│                                                              │
│  stores/configStore ─── hooks/useInterviewWS ─── lib/api    │
└──────────────────────────────┬───────────────────────────────┘
                               │  HTTP REST + WebSocket
                               ▼
┌──────────────────────────────────────────────────────────────┐
│                  backend/ (FastAPI + Uvicorn)                 │
│                                                              │
│  api/                          services/                     │
│  ├── assist/                   ├── stt/                      │
│  │   ├── routes.py (HTTP)      │   ├── text_utils.py         │
│  │   └── pipeline.py (核心)    │   ├── engines.py            │
│  ├── common/  (通用配置)       │   └── factory.py            │
│  ├── practice/ (模拟练习)      ├── llm/                      │
│  ├── jobs/    (求职跟踪)       │   ├── prompts.py            │
│  ├── analytics/(能力分析)      │   └── streaming.py          │
│  ├── resume/  (简历优化)       ├── audio.py                  │
│  └── realtime/ (WebSocket)     ├── storage/ (SQLite)         │
│                                └── capture/ (截图)           │
│  core/                                                       │
│  ├── config.py                                               │
│  └── session.py                                              │
└──────────────────────────────────────────────────────────────┘
```

### 技术栈

| 层 | 技术 |
|---|------|
| **前端** | React 18 · TypeScript · Vite · Zustand · Tailwind CSS · @dnd-kit · @tanstack/table |
| **后端** | Python 3.10+ · FastAPI · Uvicorn · WebSocket |
| **语音识别** | faster-whisper (本地) · 豆包 (Volcengine) · 讯飞 |
| **LLM** | OpenAI 兼容接口 · 多模型并行 · Think 推理 · 识图 |
| **存储** | SQLite (本地持久化) |
| **桌面** | Electron (可选) |

## 快速开始

### 1. 准备环境

- Python `3.10+`
- Node.js `18+`

### 2. 安装与配置

```bash
git clone https://github.com/powAu3/interview-assistant.git
cd interview-assistant

pip install -r backend/requirements.txt

# 安装并构建前端
cd frontend
npm install
npm run build
cd ..

cp backend/config.example.json backend/config.json
# 编辑 backend/config.json，填入你的模型 API Key
```

### 3. 启动

```bash
python start.py                 # 桌面模式（Electron）
python start.py --mode network  # 浏览器模式，默认 http://localhost:18080
```

补充说明：

- 首次启动若前端尚未构建，`start.py` 会自动安装前端依赖并构建，所以本机仍需要 Node.js。
- `python quick-start.py` 等价于桌面模式的快捷启动，适合已经构建过前端的情况。

推荐优先使用桌面模式：`python start.py`。
如果只想用浏览器访问，可运行 `python start.py --mode network`。

更多配置见：[配置说明](docs/配置说明.md)、[API 密钥与模型](docs/API密钥与模型.md)、[音频配置](docs/音频配置.md)、[豆包语音识别](docs/豆包语音识别.md)。

## 开发与自测

```bash
cd frontend && npm run dev
cd backend && python -m uvicorn main:app --host 127.0.0.1 --port 18080 --reload

cd frontend && npm test
python -m pytest backend/tests -q
```

更新 README 截图：

```bash
cd frontend
npx playwright install chromium   # 首次执行需要
npm run screenshots:readme
npm run demo:readme
```

截图和演示 GIF 都会自动输出到 `docs/screenshots/`，详细说明见 [docs/screenshots/README.md](docs/screenshots/README.md)。

## 项目结构

```
interview-assistant/
├── start.py                 # 统一入口：环境准备 → 前端构建 → 后端启动 → Electron
├── backend/
│   ├── main.py              # FastAPI 应用入口
│   ├── api/                 # 路由层 (assist, common, practice, jobs, analytics, resume, realtime)
│   ├── core/                # 配置 + 会话管理
│   ├── services/            # 业务逻辑 (stt/, llm/, audio, storage/, capture/)
│   └── tests/               # pytest 测试
├── frontend/
│   └── src/
│       ├── App.tsx           # 主入口组件
│       ├── components/       # 功能组件 (实时辅助, 练习, 看板, 分析, 简历, 设置)
│       ├── stores/           # Zustand 全局状态
│       ├── hooks/            # WebSocket Hook
│       └── lib/              # API 封装 + 工具函数
├── desktop/                  # Electron 壳 (可选)
└── docs/                     # 文档 + 截图
```

## 常见问题

- **Node / npm 报错**：请确认 Node.js 版本为 `18+`。
- **Electron 下载慢**：可先设置 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/` 后再在 `desktop/` 执行 `npm install`。
- **macOS 下 sounddevice 安装失败**：先执行 `brew install portaudio`。
- **Whisper 模型下载慢**：可设置 `export HF_ENDPOINT=https://hf-mirror.com`。
- **端口冲突**：可改为 `python start.py --port 9090`。

## 开源协议与免责

- **协议**：[CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/)。
- **免责**：项目仅供学习研究，请勿用于学术不端、违规考试或其他不合规场景；使用后果自行承担。

## 赞赏

若对你有帮助，欢迎请作者喝杯咖啡：

<p align="center">
  <img src="docs/skm.png" width="260" alt="赞赏码" />
</p>
