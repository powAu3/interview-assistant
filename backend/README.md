# 后端目录说明

启动入口为 **`main.py`**（`uvicorn main:app`，工作目录为本文件夹）。

## 数据目录

| 路径 | 说明 |
|------|------|
| **`data/`** | 运行时 SQLite：`knowledge.db`、`job_tracker.db` 及 `-wal/-shm`。首次启动若根目录仍有旧库会自动迁入。 |
| **`data/.gitkeep`** | 空库占位；实际 `.db` 见 `.gitignore`。 |

## 源码分层

| 目录 | 说明 |
|------|------|
| **`api/`** | FastAPI 路由，**按前端 Tab 分子包**（见 `api/__init__.py` 文档字符串）。 |
| `api/realtime/` | WebSocket 广播。 |
| `api/common/` | 配置、设备、简历上传、模型健康检测等（多 Tab 共用）。 |
| `api/assist/` | 实时辅助（录音、转写、问答）。 |
| `api/practice/` | 模拟练习。 |
| `api/analytics/` | 能力分析（`/knowledge/*` 接口保持兼容）。 |
| `api/resume/` | 简历优化。 |
| `api/jobs/` | 求职看板（`/job-tracker/*`）。 |
| **`core/`** | `config.py`、`session.py`。 |
| **`services/`** | 业务实现：`stt`、`llm`、`audio`、`resume`、`practice` 等。 |
| **`services/storage/`** | SQLite 访问逻辑与 `paths.py`（统一 `data/` 路径）。 |
| **`services/capture/`** | 本机截屏子进程。 |

## 配置

- **`config.json`**：本地配置（gitignore，从 `config.example.json` 复制）。

豆包热词表见仓库 **`docs/stt/`**。
