# 智能面试学习辅助助手

实时语音转写、AI 问答、模拟练习与简历优化；多模型、多技术栈。桌面端可对屏幕共享隐身，降低误分享助手界面的风险。欢迎 clone / Star 试用。

<p align="center">
  <img src="https://img.shields.io/badge/license-CC%20BY--NC%204.0-blue" alt="License" />
  <img src="https://img.shields.io/badge/python-3.10+-green" alt="Python" />
  <img src="https://img.shields.io/badge/node-18+-orange" alt="Node" />
</p>

---

## 界面预览

| 实时辅助 | 模拟练习 | 能力分析 | 简历优化 |
| :---: | :---: | :---: | :---: |
| ![实时辅助](docs/screenshots/assist-mode.png) | ![模拟练习](docs/screenshots/practice-mode.png) | ![能力分析](docs/screenshots/knowledge-map.png) | ![简历优化](docs/screenshots/resume-optimizer.png) |

> 若上图不显示，请按 [docs/screenshots/README.md](docs/screenshots/README.md) 将四张 PNG 放到 `docs/screenshots/`（与仓库中文件名一致）。

---

## 功能概览

- **实时辅助**：系统/麦克风 → Whisper 转写 → 自动或手动提问 → 流式答案；支持暂停、清空、取消生成。
- **模拟练习**：AI 出题 → 作答 → 即时评分与报告。
- **能力分析**：知识图谱与雷达图，薄弱点出题。
- **简历优化**：上传 PDF/DOCX/DOC，对照 JD 给出匹配度与修改建议。
- **简历上传历史**：最近 **10** 份原件保留在 `backend/data/resume_uploads/`（不入 git）；解析失败也会存档，可在底栏「历史」或简历页选用、删除；列表**最近使用的在下方**（与能力分析「新在上」相反）。
- **求职看板（仅 Electron）**：本地 SQLite 表格 + **管道视图**（阶段导航、列内拖拽排序写 `sort_order`、卡片 **阶段下拉**、可选 **显示已结束**）；Offer 与多 Offer 对比；浏览器/手机无此入口。
- **多模型**：OpenAI 兼容接口，界面切换；Think、识图；主模型不可用时自动降级。
- **桌面 / 网络**：Electron（共享隐身、Boss Key）或浏览器（局域网扫码）。
- **设置**：顶栏齿轮 — 答案卡片/流式、扫码、快捷词、**配色**等；滑块入口 — **配置**（模型并行、VAD、LLM）。多路生成时流式布局带提示条。
- **配色**：**Dark+ / Light+ / Dark 高对比**（参考 VS Code），`localStorage` 记忆；代码高亮与**选中文本**按主题配色，保证对比度。

### 多模型并行与来源

- **顶栏**选「优先」模型：有空槽时题目优先派给它；多题并行时其余题目按**配置里模型列表自上而下**占满路数。
- **设置 → 配置**：调整模型顺序、启用/关闭、**最大并行路数**（`max_parallel_answers`）；关闭的模型不参与答题。
- 多路可用时多题**并行**；槽满则**排队**；仅一路时与串行一致。
- 题目带**来源**（会议拾音 / 本机麦 / 速记 / 截图审题），答案带**所用模型**；Header Token 大于 0 时显示，**悬停**可看按模型分流。
- 配好 API 后可在界面内连续提问或多次速记，结合多模型设置自行验证并行与排队。

---

## 快速开始

**环境**：Python 3.10+、Node.js 18+（可用 pyenv，仓库含 `.python-version`）。

```bash
git clone https://github.com/powAu3/interview-assistant.git
cd interview-assistant

pip install -r backend/requirements.txt

cd frontend && npm install && npm run build && cd ..

cp backend/config.example.json backend/config.json
# 编辑 backend/config.json 填入 API Key

python start.py                 # 桌面（Electron）
python start.py --mode network  # 浏览器 http://localhost:18080
```

`python quick-start.py` 等价桌面模式并跳过前端构建。

更多说明：[docs/配置说明.md](docs/配置说明.md)、[docs/API密钥与模型.md](docs/API密钥与模型.md)、[docs/豆包语音识别.md](docs/豆包语音识别.md)、[docs/音频配置.md](docs/音频配置.md)。

---

## 配置与运行模式

- **配置**：`backend/config.json`（由 `config.example.json` 复制），含模型、STT、岗位/语言、VAD 等。
- **桌面**：`python start.py` — Electron、共享隐身、Ctrl+B、托盘与置顶。
- **窗口标题**：`desktop/app-title.json` 的 `appDisplayName`，或环境变量 `ELECTRON_APP_DISPLAY_NAME`（优先），或 `desktop/package.json` 的 `appDisplayName`；浏览器标题见 `frontend/index.html`。
- **网络**：`python start.py --mode network`；设置底部可扫码。
- **手机「左屏审题写码」**（窄屏）：由**运行后端的电脑**在子进程截主屏指定区域送识图模型；该请求不写 access 日志。若仍抢焦点可 `IA_ACCESS_LOG=0 python start.py`。需 `mss`、macOS 屏幕录制权限、识图模型。区域可在配置中选全屏/半屏等。
- **勿提交**密钥：`config.json`、`.env` 等已在 `.gitignore`。

---

## 开发与自测

```bash
cd frontend && npm run dev
cd backend && python -m uvicorn main:app --host 127.0.0.1 --port 18080 --reload

python scripts/e2e_test.py
```

---

## 常见问题

- **npm / Node**：需 Node.js 18+（如 `nvm install 18`）。
- **Electron 慢**：`ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/` 后在 `desktop/` 执行 `npm install`。
- **sounddevice（macOS）**：先 `brew install portaudio`。
- **Whisper 慢**：`export HF_ENDPOINT=https://hf-mirror.com`。
- **端口占用**：`python start.py --port 9090` 或释放 18080。

---

## 开源协议与免责

- **协议**：[CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/) — 个人与非商业可用，商用需授权。
- **免责**：仅供学习研究，后果自负；请勿用于学术不端或违规场景。

---

## 赞赏

若对你有帮助，欢迎请作者喝杯咖啡：

<p align="center">
  <img src="docs/skm.png" width="260" alt="赞赏码" />
</p>
