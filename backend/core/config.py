from pydantic import BaseModel, Field, model_validator
from typing import Optional
import json
import logging
import os
import shutil

logger = logging.getLogger(__name__)

_BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONFIG_FILE = os.path.join(_BACKEND_DIR, "config.json")
CONFIG_EXAMPLE = os.path.join(_BACKEND_DIR, "config.example.json")


class ModelConfig(BaseModel):
    name: str = "Default"
    api_base_url: str = "https://api.openai.com/v1"
    api_key: str = ""
    model: str = "gpt-4o-mini"
    supports_think: bool = False
    supports_vision: bool = False
    enabled: bool = True


def _default_model_config() -> ModelConfig:
    return ModelConfig(
        name="请在 config.json 中配置",
        api_base_url="https://api.openai.com/v1",
        api_key="",
        model="gpt-4o-mini",
    )


class AppConfig(BaseModel):
    models: list[ModelConfig] = Field(default_factory=lambda: [_default_model_config()])
    active_model: int = 0

    temperature: float = 0.5
    max_tokens: int = 4096
    think_mode: bool = False

    # 语音识别：whisper=本地 faster-whisper，doubao=豆包语音识别 API
    stt_provider: str = "whisper"
    whisper_model: str = "base"
    # "auto" is more robust for Chinese interview speech mixed with English terms.
    whisper_language: str = "auto"
    # 豆包语音识别 API（当 stt_provider=doubao 时使用），使用小时版 + WebSocket 双流式
    doubao_stt_app_id: str = ""
    doubao_stt_access_token: str = ""
    # 资源 ID：豆包流式语音识别模型2.0 小时版
    doubao_stt_resource_id: str = "volc.seedasr.sauc.duration"
    # 热词表 ID：在自学习平台上传热词文件后获得；有则传入请求，没有则不传
    doubao_stt_boosting_table_id: str = ""

    position: str = "后端开发"
    language: str = "Python"
    # 模拟面试候选人维度：campus_intern=校招/实习，social=社招
    practice_audience: str = "campus_intern"
    resume_text: Optional[str] = None
    # 当前生效的简历对应的历史记录 id（写入 config.json；简历正文仍不入库）
    resume_active_history_id: Optional[int] = None

    auto_detect: bool = True
    silence_threshold: float = 0.01
    # Lower default reduces turn latency after interviewer finishes speaking.
    silence_duration: float = 1.2
    # 同时生成答案的最大路数（受可用模型数限制）
    max_parallel_answers: int = 2
    # 答案区流式输出时，距底部小于该像素则自动滚到底（调小便于手动上滑回看）
    answer_autoscroll_bottom_px: int = 40
    # 转写广播/入历史/自动答题：去标点后的有效字符（中英数字）至少为该值；过滤「嗯」等
    transcription_min_sig_chars: int = 2
    # 实时辅助：多段 ASR 合并后再写入转写/触发自动答题。上一段结束后若超过该秒数仍无新段则送出；0=关闭合并（恢复每段立即发送）
    assist_transcription_merge_gap_sec: float = 2.0
    # 从第一段 ASR 起最长等待（秒），超时强制送出，避免对方长停顿导致永远不触发
    assist_transcription_merge_max_sec: float = 12.0
    # 电脑截图区域：full=全屏，left_half/right_half/top_half/bottom_half=对应半屏
    screen_capture_region: str = "left_half"

    @model_validator(mode="after")
    def _ensure_valid_models(self):
        if not self.models:
            self.models = [_default_model_config()]
        self.active_model = max(0, min(int(self.active_model), len(self.models) - 1))
        return self

    def get_active_model(self) -> ModelConfig:
        idx = max(0, min(self.active_model, len(self.models) - 1))
        return self.models[idx]


_config: Optional[AppConfig] = None


def get_config() -> AppConfig:
    global _config
    if _config is None:
        _config = _load_config()
    return _config


def update_config(updates: dict) -> AppConfig:
    global _config
    cfg = get_config()
    data = cfg.model_dump()
    for k, v in updates.items():
        if hasattr(cfg, k):
            data[k] = v
    _config = AppConfig(**data)
    _save_config(_config)
    return _config


def _load_config() -> AppConfig:
    if not os.path.exists(CONFIG_FILE):
        if os.path.exists(CONFIG_EXAMPLE):
            shutil.copy2(CONFIG_EXAMPLE, CONFIG_FILE)
            print(f"[Config] 已从 config.example.json 创建 config.json，请填入你的 API Key")
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                return AppConfig(**json.load(f))
        except Exception as e:
            print(f"[Config] 配置文件解析失败: {e}，使用默认配置")
    return AppConfig()


def _save_config(cfg: AppConfig) -> bool:
    try:
        data = cfg.model_dump()
        data.pop("resume_text", None)
        with open(CONFIG_FILE, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        return True
    except Exception as e:
        logger.warning("保存配置失败: %s", e, exc_info=True)
        return False


POSITION_OPTIONS = [
    "前端开发", "后端开发", "全栈开发", "算法工程师", "测试开发",
    "机器学习工程师", "数据开发", "DBA", "产品经理", "项目经理",
]
LANGUAGE_OPTIONS = [
    "Python", "Java", "C++", "JavaScript", "TypeScript",
    "Go", "SQL",
]
PRACTICE_AUDIENCE_OPTIONS = ["campus_intern", "social"]
WHISPER_MODEL_OPTIONS = ["tiny", "base", "small", "medium", "large-v3"]
# 语音识别引擎：whisper=本地，doubao=豆包 API
STT_PROVIDER_OPTIONS = ["whisper", "doubao"]
# 电脑截图区域
SCREEN_CAPTURE_REGION_OPTIONS = ["full", "left_half", "right_half", "top_half", "bottom_half"]
