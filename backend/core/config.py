from pydantic import BaseModel
from typing import Optional
import json
import os
import shutil

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


class AppConfig(BaseModel):
    models: list[ModelConfig] = [
        ModelConfig(
            name="请在 config.json 中配置",
            api_base_url="https://api.openai.com/v1",
            api_key="",
            model="gpt-4o-mini",
        ),
    ]
    active_model: int = 0

    temperature: float = 0.7
    max_tokens: int = 4096
    think_mode: bool = False

    whisper_model: str = "base"
    whisper_language: str = "zh"

    position: str = "后端开发"
    language: str = "Python"
    resume_text: Optional[str] = None

    auto_detect: bool = True
    silence_threshold: float = 0.01
    silence_duration: float = 2.5

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
    data.update({k: v for k, v in updates.items() if v is not None})
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


def _save_config(cfg: AppConfig):
    try:
        data = cfg.model_dump()
        data.pop("resume_text", None)
        with open(CONFIG_FILE, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
    except Exception:
        pass


POSITION_OPTIONS = [
    "前端开发", "后端开发", "全栈开发", "算法工程师", "测试开发",
    "机器学习工程师", "数据开发", "DBA", "产品经理", "项目经理",
]
LANGUAGE_OPTIONS = [
    "Python", "Java", "C++", "JavaScript", "TypeScript",
    "Go", "SQL",
]
WHISPER_MODEL_OPTIONS = ["tiny", "base", "small", "medium"]
