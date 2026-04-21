from __future__ import annotations

import base64
import importlib.util
import json
import re
import tempfile
import asyncio
from pathlib import Path
from typing import Literal
from urllib.parse import urlencode

import requests

from core.config import get_config

VOLCENGINE_SAMI_DOMAIN = "https://sami.bytedance.com"
VOLCENGINE_TTS_VERSION = "v4"
VOLCENGINE_TTS_NAMESPACE = "TTS"

VoiceGender = Literal["auto", "female", "male"]

_COMMON_TERM_REPLACEMENTS = [
    ("PostgreSQL", "Postgres sequel"),
    ("MySQL", "My sequel"),
    ("SQL", "sequel"),
    ("JVM", "J V M"),
    ("API", "A P I"),
    ("SDK", "S D K"),
    ("HTTP", "H T T P"),
    ("HTTPS", "H T T P S"),
    ("TCP", "T C P"),
    ("UDP", "U D P"),
    ("RPC", "R P C"),
    ("gRPC", "G R P C"),
    ("JWT", "J W T"),
    ("JSON", "J S O N"),
    ("YAML", "Y A M L"),
    ("CDN", "C D N"),
    ("DNS", "D N S"),
]

_ZH_TERM_REPLACEMENTS = [
    ("Redis", "Ree dis"),
    ("Kafka", "Kaf ka"),
    ("Nginx", "Engine X"),
    ("Linux", "Linucks"),
    ("MongoDB", "Mongo D B"),
    ("RabbitMQ", "Rabbit M Q"),
    ("Elasticsearch", "Elastic Search"),
    ("OpenTelemetry", "Open Telemetry"),
    ("ClickHouse", "Click House"),
    ("Prometheus", "Prometheus"),
    ("Grafana", "Grafana"),
    ("Kubernetes", "Kuber net ease"),
    ("TypeScript", "Type Script"),
    ("JavaScript", "Java Script"),
    ("OAuth", "Oh Auth"),
]

_EN_TERM_REPLACEMENTS = [
    ("ClickHouse", "Click House"),
    ("OpenTelemetry", "Open Telemetry"),
    ("RabbitMQ", "Rabbit M Q"),
    ("MongoDB", "Mongo D B"),
    ("Nginx", "Engine X"),
    ("OAuth", "Oh Auth"),
]


def _speaker_for_gender(preferred_gender: VoiceGender) -> str:
    cfg = get_config()
    if preferred_gender == "male":
        return (getattr(cfg, "practice_tts_speaker_male", "") or "zh_male_chunhou").strip()
    if preferred_gender == "female":
        return (getattr(cfg, "practice_tts_speaker_female", "") or "zh_female_qingxin").strip()
    return (getattr(cfg, "practice_tts_speaker_female", "") or "zh_female_qingxin").strip()


def _edge_voice_for_gender(preferred_gender: VoiceGender) -> str:
    cfg = get_config()
    if preferred_gender == "male":
        return (getattr(cfg, "edge_tts_voice_male", "") or "zh-CN-YunxiNeural").strip()
    if preferred_gender == "female":
        return (getattr(cfg, "edge_tts_voice_female", "") or "zh-CN-XiaoxiaoNeural").strip()
    return (getattr(cfg, "edge_tts_voice_female", "") or "zh-CN-XiaoxiaoNeural").strip()


def normalize_tts_text(text: str, locale_hint: str = "zh") -> str:
    normalized = str(text or "").strip()
    replacements = list(_COMMON_TERM_REPLACEMENTS)
    replacements.extend(_EN_TERM_REPLACEMENTS if locale_hint.lower().startswith("en") else _ZH_TERM_REPLACEMENTS)
    for src, target in replacements:
        escaped = re.escape(src)
        normalized = re.sub(
            rf"(^|[^A-Za-z])({escaped})(?=[^A-Za-z]|$)",
            lambda match: f"{match.group(1)}{target}",
            normalized,
        )
    return normalized


def _volcengine_tts_url() -> str:
    cfg = get_config()
    token = (getattr(cfg, "volcengine_tts_token", "") or "").strip()
    appkey = (getattr(cfg, "volcengine_tts_appkey", "") or "").strip()
    if not token or not appkey:
        raise ValueError("火山引擎 TTS 未配置 appkey / token")
    query = urlencode(
        {
            "version": VOLCENGINE_TTS_VERSION,
            "token": token,
            "appkey": appkey,
            "namespace": VOLCENGINE_TTS_NAMESPACE,
        }
    )
    return f"{VOLCENGINE_SAMI_DOMAIN}/api/v1/invoke?{query}"


def get_edge_tts_status() -> dict:
    available = importlib.util.find_spec("edge_tts") is not None
    return {
        "edge_tts_available": available,
        "edge_tts_status_detail": "edge-tts Python 包可用" if available else "未安装 edge-tts，请执行 pip install edge-tts",
    }


def synthesize_volcengine_tts(
    text: str,
    *,
    preferred_gender: VoiceGender = "auto",
    speaker: str | None = None,
    audio_format: str = "mp3",
    sample_rate: int = 24000,
) -> dict:
    clean_text = normalize_tts_text(text, locale_hint="zh")
    if not clean_text:
        raise ValueError("TTS 文本不能为空")

    resolved_speaker = (speaker or _speaker_for_gender(preferred_gender)).strip()
    url = _volcengine_tts_url()
    payload = {
        "text": clean_text,
        "speaker": resolved_speaker,
        "audio_config": {
            "format": audio_format,
            "sample_rate": sample_rate,
        },
    }
    body = {"payload": json.dumps(payload, ensure_ascii=False)}
    response = requests.post(url, json=body, timeout=25)
    response.raise_for_status()
    data = response.json()

    status_code = int(data.get("status_code") or 0)
    if status_code != 20000000:
        raise ValueError(data.get("status_text") or f"火山引擎 TTS 调用失败: {status_code}")

    audio_base64 = data.get("data") or ""
    if not audio_base64:
        raise ValueError("火山引擎 TTS 未返回音频数据")

    payload_data = {}
    raw_payload = data.get("payload") or "{}"
    if isinstance(raw_payload, str):
        try:
            payload_data = json.loads(raw_payload)
        except json.JSONDecodeError:
            payload_data = {}

    audio_bytes = base64.b64decode(audio_base64)
    content_type = "audio/mpeg" if audio_format == "mp3" else f"audio/{audio_format}"
    return {
        "provider": "volcengine",
        "speaker": resolved_speaker,
        "audio_bytes": audio_bytes,
        "audio_base64": audio_base64,
        "content_type": content_type,
        "duration": float(payload_data.get("duration") or 0),
    }


def synthesize_edge_tts(
    text: str,
    *,
    preferred_gender: VoiceGender = "auto",
    voice: str | None = None,
    rate: str | None = None,
    pitch: str | None = None,
) -> dict:
    cfg = get_config()
    resolved_voice = (voice or _edge_voice_for_gender(preferred_gender)).strip()
    clean_text = normalize_tts_text(text, locale_hint=resolved_voice.split("-")[0].lower())
    if not clean_text:
        raise ValueError("TTS 文本不能为空")
    if importlib.util.find_spec("edge_tts") is None:
        raise ValueError("edge-tts 未安装，请先执行 pip install edge-tts")
    import edge_tts  # type: ignore

    resolved_rate = (rate or getattr(cfg, "edge_tts_rate", "+0%") or "+0%").strip()
    resolved_pitch = (pitch or getattr(cfg, "edge_tts_pitch", "+0Hz") or "+0Hz").strip()

    tmpdir = Path(tempfile.mkdtemp(prefix="ia-edge-tts-"))
    output_path = tmpdir / "out.mp3"

    async def _run() -> None:
        communicate = edge_tts.Communicate(clean_text, resolved_voice, rate=resolved_rate, pitch=resolved_pitch)
        await communicate.save(str(output_path))

    try:
        asyncio.run(_run())
        if not output_path.exists():
            raise ValueError("EdgeTTS 未生成输出音频")
        audio_bytes = output_path.read_bytes()
        return {
            "provider": "edge_tts",
            "speaker": resolved_voice,
            "audio_bytes": audio_bytes,
            "audio_base64": base64.b64encode(audio_bytes).decode("utf-8"),
            "content_type": "audio/mpeg",
            "duration": 0.0,
        }
    finally:
        try:
            if output_path.exists():
                output_path.unlink()
            tmpdir.rmdir()
        except Exception:
            pass


def volcengine_tts_configured() -> bool:
    cfg = get_config()
    return bool(
        (getattr(cfg, "practice_tts_provider", "local") or "local") == "volcengine"
        and (getattr(cfg, "volcengine_tts_appkey", "") or "").strip()
        and (getattr(cfg, "volcengine_tts_token", "") or "").strip()
    )


def edge_tts_configured() -> bool:
    cfg = get_config()
    if (getattr(cfg, "practice_tts_provider", "edge_tts") or "edge_tts") != "edge_tts":
        return False
    return bool(get_edge_tts_status()["edge_tts_available"])
