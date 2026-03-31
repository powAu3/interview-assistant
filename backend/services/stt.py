"""Speech-to-text: faster-whisper (local) or 豆包语音识别 API.

Whisper: language="auto", temperature fallback；技术词见本模块 TECH_VOCAB / TERM_CORRECTIONS。
Doubao: 火山引擎流式 ASR（小时版）；控制台热词表词文件见仓库 docs/stt/。
"""

import gzip
import io
import json
import re
import struct
import uuid
import numpy as np
import threading
from typing import Optional, Any, cast

try:
    import websocket
    _WS_TIMEOUT = getattr(websocket, "WebSocketTimeoutException", TimeoutError)
    _WS_CLOSED = getattr(websocket, "WebSocketConnectionClosedException", ConnectionError)
except ImportError:
    websocket = None
    _WS_TIMEOUT = TimeoutError
    _WS_CLOSED = ConnectionError

# ---------------------------------------------------------------------------
# Vocabulary banks – used for initial_prompt and post-processing corrections
# ---------------------------------------------------------------------------

TECH_VOCAB = {
    "通用": (
        "API Redis MySQL PostgreSQL MongoDB Nginx Docker Kubernetes HTTP HTTPS "
        "WebSocket TCP UDP JSON XML YAML REST GraphQL gRPC OAuth JWT "
        "Linux macOS Windows Git GitHub CI CD DevOps microservice "
        "CPU GPU 内存 缓存 数据库 消息队列 负载均衡 分布式 高并发 高可用"
    ),
    "Python": (
        "Python Django Flask FastAPI SQLAlchemy Celery asyncio await async "
        "pip venv conda NumPy Pandas PyTorch TensorFlow Pydantic uvicorn "
        "GIL 装饰器 生成器 协程 元类 描述符 上下文管理器 列表推导式"
    ),
    "Java": (
        "Java Spring SpringBoot MyBatis Maven Gradle JVM JDK JRE "
        "HashMap ConcurrentHashMap ArrayList LinkedList ThreadPool "
        "synchronized volatile AOP IOC Bean Tomcat Netty Dubbo "
        "垃圾回收 类加载 字节码 反射 注解 泛型 多线程 线程池"
    ),
    "JavaScript": (
        "JavaScript TypeScript React Vue Angular Next Nuxt Node Express "
        "npm Webpack Vite ESLint Babel Promise async await fetch "
        "DOM 闭包 原型链 事件循环 虚拟DOM Hooks 组件 状态管理 Zustand Redux"
    ),
    "Go": (
        "Go Golang goroutine channel select defer interface struct "
        "sync Mutex WaitGroup context net/http gin gorm protobuf "
        "GC 内存逃逸 并发 协程调度 GOMAXPROCS"
    ),
    "C++": (
        "C++ STL vector map unordered_map shared_ptr unique_ptr "
        "template 多态 虚函数 析构函数 RAII 智能指针 内存管理 指针 引用 "
        "move semantics lambda constexpr"
    ),
    "后端开发": (
        "Redis ZSET SET HASH LIST HyperLogLog 布隆过滤器 "
        "主从复制 哨兵 集群 持久化 RDB AOF 缓存穿透 缓存雪崩 缓存击穿 "
        "MySQL 索引 B+树 事务 MVCC 锁 死锁 分库分表 读写分离 binlog "
        "Kafka RabbitMQ RocketMQ Elasticsearch Zookeeper etcd "
        "限流 熔断 降级 幂等 分布式锁 分布式事务 CAP BASE Raft Paxos"
    ),
    "前端开发": (
        "HTML CSS Flexbox Grid BFC 回流 重绘 浏览器渲染 "
        "跨域 CORS JSONP Cookie Session LocalStorage "
        "Webpack Vite HMR Tree Shaking 代码分割 懒加载 SSR SSG"
    ),
    "算法工程师": (
        "Transformer BERT GPT LLM CNN RNN LSTM GAN Diffusion "
        "梯度下降 反向传播 损失函数 学习率 正则化 Dropout BatchNorm "
        "PyTorch TensorFlow ONNX CUDA 推理 训练 微调 量化 蒸馏 LoRA PEFT"
    ),
    "测试开发": (
        "Selenium Playwright Pytest JMeter 接口测试 性能测试 "
        "自动化测试 持续集成 Mock 断言 测试用例 覆盖率 回归测试 "
        "Allure Jenkins SonarQube"
    ),
    "数据开发": (
        "Spark Flink Hadoop Hive HBase Presto Airflow "
        "ETL 数据仓库 数据湖 ODS DWD DWS ADS 维度建模 "
        "Parquet ORC Avro Kafka ClickHouse Doris Impala"
    ),
}

TERM_CORRECTIONS = {
    r"(?i)radex|reddis|redist": "Redis",
    r"(?i)(?<![a-zA-Z])C\s*SET(?![a-zA-Z])": "ZSET",
    r"(?i)my\s*sequel": "MySQL",
    r"(?i)post\s*gre": "PostgreSQL",
    r"(?i)dacker|docker\s*r": "Docker",
    r"(?i)kubernetes|k\s*8\s*s": "Kubernetes",
    r"(?i)(?<![a-zA-Z])g\s*i\s*l(?![a-zA-Z])": "GIL",
    r"(?i)fast\s*a\s*p\s*i": "FastAPI",
    r"(?i)web\s*socket": "WebSocket",
    r"(?i)spring\s*boot": "SpringBoot",
    r"(?i)my\s*batis": "MyBatis",
    r"(?i)mongo\s*d\s*b": "MongoDB",
    r"(?i)rabbit\s*m\s*q": "RabbitMQ",
    r"(?i)elastic\s*search": "Elasticsearch",
    r"(?i)ngin\s*x|engine\s*x": "Nginx",
    r"(?i)pie\s*test|pie\s*tests": "Pytest",
    r"(?i)pie\s*torch": "PyTorch",
    r"(?i)tensor\s*flow": "TensorFlow",
    r"(?i)git\s*hub": "GitHub",
    r"(?i)go\s*lang": "Golang",
    r"(?i)zookeeper": "Zookeeper",
    r"(?i)click\s*house": "ClickHouse",
    r"(?i)kafka": "Kafka",
    # Common interview-term misrecognitions (accent / unclear enunciation)
    r"(?i)(?<![a-zA-Z])z\s*set(?![a-zA-Z])": "ZSET",
    r"(?i)sort(?:ed)?\s*set": "Sorted Set",
    r"(?i)spring\s*cloud": "Spring Cloud",
    r"(?i)concurrent\s*hash\s*map": "ConcurrentHashMap",
    r"(?i)hash\s*map": "HashMap",
    r"(?i)thread\s*pool": "ThreadPool",
    r"(?i)dead\s*lock": "deadlock",
    r"(?i)k\s*eight\s*s|kates|k8s": "Kubernetes",
    r"(?i)(?<![a-zA-Z])mq(?![a-zA-Z])": "MQ",
    r"(?i)my\s*sql": "MySQL",
}

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_t2s_converter: Any = None


def _get_t2s_converter():
    global _t2s_converter
    if _t2s_converter is None:
        try:
            import opencc
            _t2s_converter = opencc.OpenCC("t2s")
        except ImportError:
            _t2s_converter = False
    return _t2s_converter


# 中日韩统一表意文字（慢语速 ASR 常在相邻汉字间插入逗号/句号，见下方统一归一）
_CJK = r"\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff"

# 相邻「汉字 + 标点 + 汉字」：逗号与句号在同一套逻辑里处理，避免到处改
_PAT_CJK_COMMA_FW = re.compile(rf"([{_CJK}])，([{_CJK}])")
_PAT_CJK_COMMA_ASCII = re.compile(rf"([{_CJK}]),([{_CJK}])")
_PAT_CJK_PERIOD_FW = re.compile(rf"([{_CJK}])。([{_CJK}])")
_PAT_CJK_PERIOD_ASCII = re.compile(rf"([{_CJK}])\.([{_CJK}])")


def _normalize_slow_speech_intraword_punct(text: str) -> str:
    """慢语速 ASR 常在**相邻汉字之间**插入逗号或句号，如「你，好」「你。好」「做。一。下，自，我，介，绍」。

    统一在本函数处理（仅此一处；多段 VAD 拼接见 `join_transcription_fragments`，不负责句内标点）。

    策略：
    - 统计「字，字」「字。字」（含半角 , .）出现次数，**合计**判断；
    - 不少于 2 处时整段迭代去掉中间标点（慢读长句）；
    - 仅 1 处且全句汉字数 <=3 时再合并（如「你，好」），避免误伤「中国，美国」「你好。请问」等。
    - 不匹配含空格的片段，以免误伤正常停顿。
    """
    if not text:
        return text

    def count_adjacent_cjk_punct(s: str) -> int:
        n = len(_PAT_CJK_COMMA_FW.findall(s)) + len(_PAT_CJK_COMMA_ASCII.findall(s))
        n += len(_PAT_CJK_PERIOD_FW.findall(s)) + len(_PAT_CJK_PERIOD_ASCII.findall(s))
        return n

    def cjk_len(s: str) -> int:
        return len(re.findall(rf"[{_CJK}]", s))

    adj = count_adjacent_cjk_punct(text)
    n_cjk = cjk_len(text)
    should_merge_all = adj >= 2
    should_merge_short = adj == 1 and n_cjk <= 3
    if not (should_merge_all or should_merge_short):
        return text

    t = text
    prev = None
    while prev != t:
        prev = t
        t = _PAT_CJK_COMMA_FW.sub(r"\1\2", t)
        t = _PAT_CJK_COMMA_ASCII.sub(r"\1\2", t)
        t = _PAT_CJK_PERIOD_FW.sub(r"\1\2", t)
        t = _PAT_CJK_PERIOD_ASCII.sub(r"\1\2", t)
    return t


# 旧称：与 _normalize_slow_speech_intraword_punct 为同一实现（仅逗号逻辑已并入其中）
_normalize_slow_speech_commas = _normalize_slow_speech_intraword_punct


def transcription_significant_len(text: str) -> int:
    """有效字符数：仅统计汉字、英文、数字（不含标点与空白），用于过滤「嗯」等短语气词。"""
    if not text:
        return 0
    return len(re.findall(rf"[{_CJK}A-Za-z0-9]", text))


def transcription_for_publish(text: str, min_significant_chars: int = 2) -> Optional[str]:
    """若去标点后的有效字符不足阈值，返回 None（不写入历史、不广播、不触发自动答题）。"""
    t = (text or "").strip()
    if not t:
        return None
    need = max(1, int(min_significant_chars))
    if transcription_significant_len(t) < need:
        return None
    return t


def join_transcription_fragments(parts: list[str]) -> str:
    """将 VAD 多段 ASR 拼成一句再送 LLM：中文直接衔接，英文/数字之间补空格。"""
    qs = [p.strip() for p in parts if p and str(p).strip()]
    if not qs:
        return ""
    acc = qs[0]
    for q in qs[1:]:
        need_space = bool(re.search(r"[a-zA-Z0-9]$", acc) and re.match(r"^[a-zA-Z0-9]", q))
        acc = f"{acc} {q}" if need_space else f"{acc}{q}"
    return acc.strip()


_FILLER_PREFIX = re.compile(
    r"^(?:"
    r"嗯+|啊+|呃+|额+|诶+|欸+|唉+|"
    r"那个|这个|就是|然后|所以|"
    r"我想想|让我想想|等一下|等会|等会儿|稍等"
    r")(?:[\s,，。.!！?？;；:：、]+|$)",
    re.IGNORECASE,
)
_QUESTION_CUE = re.compile(
    r"(什么|怎么|如何|为什么|为何|区别|原理|作用|流程|实现|设计|优化|排查|处理|"
    r"介绍(?:一下|下)?|说(?:一下|下)?|讲(?:一下|下)?|聊(?:一下|下)?|解释(?:一下|下)?|"
    r"分析(?:一下|下)?|怎么做|怎么办|有哪些|是否|能不能|可不可以|对比(?:一下|下)?|"
    r"展开讲讲|详细说说)",
    re.IGNORECASE,
)
_DIRECTIVE_QUESTION_CUE = re.compile(
    r"(?:请|你|麻烦|帮我|能否|能不能|可不可以).{0,24}"
    r"(?:介绍|说|讲|聊|解释|分析|设计|实现|排查|优化|比较|总结)(?:一下|下)?",
    re.IGNORECASE,
)
_INCOMPLETE_TAIL = re.compile(
    r"(?:因为|所以|然后|但是|并且|或者|以及|如果|比如|例如|就是|那个|这个|首先|其次|再然后)$",
    re.IGNORECASE,
)
_QUESTION_SPLIT = re.compile(r"[？?]+")
_QUESTION_CONNECTOR_SPLIT = re.compile(
    r"(?:[，,；;]\s*|\s+)(?=(?:再说|再讲|再聊|然后|另外|还有|还有一个|顺便|"
    r"第二个问题|另一个问题|下一个问题))",
    re.IGNORECASE,
)


def _strip_filler_prefix(text: str) -> str:
    t = (text or "").strip()
    prev = None
    while t and t != prev:
        prev = t
        t = _FILLER_PREFIX.sub("", t).strip()
    return t


def normalize_transcription_for_analysis(text: str) -> str:
    t = _strip_filler_prefix((text or "").strip())
    t = re.sub(r"\s+", " ", t)
    t = t.strip(" \t\r\n,，。.!！?？;；:：、")
    return t


def split_question_like_text(text: str) -> list[str]:
    raw = (text or "").strip()
    if not raw:
        return []

    parts = [p for p in _QUESTION_SPLIT.split(raw) if p and p.strip()]
    if not parts:
        parts = [raw]

    out: list[str] = []
    for part in parts:
        subparts = _QUESTION_CONNECTOR_SPLIT.split(part)
        for sub in subparts:
            cleaned = normalize_transcription_for_analysis(sub)
            if cleaned:
                out.append(cleaned)

    deduped: list[str] = []
    for item in out:
        if not deduped or deduped[-1] != item:
            deduped.append(item)
    return deduped


def is_stable_question_text(text: str, min_significant_chars: int = 4) -> bool:
    normalized = normalize_transcription_for_analysis(text)
    if not normalized:
        return False

    sig = transcription_significant_len(normalized)
    need = max(2, int(min_significant_chars))
    if sig < need:
        return False
    if _INCOMPLETE_TAIL.search(normalized):
        return False
    if "?" in text or "？" in text:
        return True
    if _QUESTION_CUE.search(normalized):
        return True
    if _DIRECTIVE_QUESTION_CUE.search(normalized):
        return True
    return bool(sig >= max(6, need + 1) and re.search(r"(?:吗|么|呢)$", normalized))


def _build_initial_prompt(position: str, language: str) -> str:
    """Short demonstration prompt for Whisper.

    IMPORTANT: keep this SHORT (~100 chars). Long prompts cause Whisper to
    "hallucinate" words from the prompt instead of transcribing actual audio.
    The bulk of vocabulary guidance goes into hotwords (no hallucination risk).
    """
    return (
        "这是一段技术面试语音，可能中英混说且口音不标准。"
        "请优先识别技术术语英文原词，如 Redis、ZSET、Sorted Set、MySQL、Docker、Kubernetes、API。"
    )


def _postprocess(text: str) -> str:
    converter = _get_t2s_converter()
    if converter and converter is not False and hasattr(converter, "convert"):
        text = cast(Any, converter).convert(text)
    for pattern, replacement in TERM_CORRECTIONS.items():
        text = re.sub(pattern, replacement, text)
    text = _normalize_slow_speech_intraword_punct(text)
    return text.strip()


# ---------------------------------------------------------------------------
# DoubaoSTT（豆包流式语音识别 - WebSocket 双流式，小时版）
# ---------------------------------------------------------------------------
# 协议：wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async
# 首包：Full client request (JSON)；后续包：Audio only (200ms/包)，最后一包带结束标志
# 参考：https://www.volcengine.com/docs/6561/1354869

DOUBAO_ASR_WS_URL = "wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async"
# 二进制协议（文档 1354869）：4B header, 4B payload_size (BE), payload；服务端响应为 4B header + 4B sequence + 4B payload_size + payload
# 文档示例使用 Gzip：首包 JSON 与音频包均 Gzip 压缩，服务端响应也 Gzip
# header byte0: version|header_size=0x11, byte1: msg_type|flags, byte2: serialization|compression, byte3: reserved
MSG_FULL_CLIENT_REQUEST = 0x01
MSG_AUDIO_ONLY = 0x02
MSG_FULL_SERVER_RESPONSE = 0x09
MSG_ERROR = 0x0F
FLAG_LAST_AUDIO = 0x02
COMPRESSION_GZIP = 0x01
CHUNK_MS = 200  # 推荐 200ms 一包
CHUNK_SAMPLES = 16000 * CHUNK_MS // 1000  # 3200 @ 16k


def _audio_to_pcm_int16(audio: np.ndarray) -> np.ndarray:
    if audio.dtype == np.float32 or audio.dtype == np.float64:
        if audio.max() <= 1.0 and audio.min() >= -1.0:
            return (audio * 32767).astype(np.int16)
        return audio.astype(np.int16)
    if audio.dtype != np.int16:
        return audio.astype(np.int16)
    return audio


def _build_ws_frame_full_request(
    app_key: str,
    boosting_table_id: str,
    language: str = "zh-CN",
) -> bytes:
    req: dict[str, Any] = {
        "user": {"uid": app_key},
        "audio": {
            "format": "pcm",
            "rate": 16000,
            "bits": 16,
            "channel": 1,
            "language": language if language and language != "auto" else "zh-CN",
        },
        "request": {
            "model_name": "bigmodel",
            "enable_itn": True,
            "enable_punc": True,
        },
    }
    if boosting_table_id and boosting_table_id.strip():
        req["request"]["corpus"] = {"boosting_table_id": boosting_table_id.strip()}
    payload_raw = json.dumps(req, ensure_ascii=False).encode("utf-8")
    payload = gzip.compress(payload_raw)
    # header: type=full request, JSON, Gzip（与文档示例一致）
    header = bytes([0x11, 0x10, 0x11, 0x00])
    return header + struct.pack(">I", len(payload)) + payload


def _build_ws_frame_audio(pcm_chunk: bytes, is_last: bool = False) -> bytes:
    # type=audio, flags=0 or FLAG_LAST_AUDIO, raw, Gzip
    payload = gzip.compress(pcm_chunk)
    header = bytes([0x11, 0x22 if is_last else 0x20, 0x01, 0x00])
    return header + struct.pack(">I", len(payload)) + payload


def _parse_ws_response(data: bytes) -> tuple[int, Optional[dict]]:
    """返回 (message_type, payload_dict or None)。Server response 为 type=9 时 payload 为 JSON（可能 Gzip）。"""
    if len(data) < 4:
        return 0, None
    msg_type = (data[1] >> 4) & 0x0F
    compression = data[2] & 0x0F
    if msg_type == MSG_ERROR:
        return MSG_ERROR, None
    if msg_type == MSG_FULL_SERVER_RESPONSE:
        if len(data) < 12:
            return msg_type, None
        payload_size = struct.unpack(">I", data[8:12])[0]
        if len(data) < 12 + payload_size:
            return msg_type, None
        raw = data[12 : 12 + payload_size]
        if compression == COMPRESSION_GZIP:
            try:
                raw = gzip.decompress(raw)
            except Exception:
                return msg_type, None
        try:
            payload = json.loads(raw.decode("utf-8"))
            return msg_type, payload
        except Exception:
            return msg_type, None
    return msg_type, None


class DoubaoSTT:
    """豆包流式语音识别模型2.0 小时版，WebSocket 双流式。支持热词表 ID。"""

    def __init__(
        self,
        app_id: str,
        access_token: str,
        resource_id: str = "volc.seedasr.sauc.duration",
        boosting_table_id: str = "",
    ):
        self.app_id = app_id or ""
        self.access_token = access_token or ""
        self.resource_id = resource_id or "volc.seedasr.sauc.duration"
        self.boosting_table_id = boosting_table_id or ""

    @property
    def model_size(self) -> str:
        return "doubao"

    @property
    def is_loaded(self) -> bool:
        return True

    @property
    def is_loading(self) -> bool:
        return False

    def load_model(self) -> None:
        pass

    def change_model(self, _model_size: str) -> None:
        pass

    def transcribe(self, audio: np.ndarray, sample_rate: int = 16000,
                  position: str = "后端开发", language: str = "Python") -> str:
        if not self.access_token or websocket is None:
            return ""
        app_key = self.app_id or self.access_token
        pcm = _audio_to_pcm_int16(audio)
        if sample_rate != 16000:
            # 线性插值重采样到 16k（API 要求 16000）
            n_orig = len(pcm)
            n_new = int(round(n_orig * 16000 / sample_rate))
            if n_new < 1:
                n_new = 1
            indices = np.linspace(0, n_orig - 1, n_new).astype(np.int32)
            pcm = pcm[indices]

        first_frame = _build_ws_frame_full_request(
            app_key, self.boosting_table_id, language="zh-CN"
        )
        n_samples = len(pcm)
        chunks = []
        offset = 0
        while offset < n_samples:
            take = min(CHUNK_SAMPLES, n_samples - offset)
            chunk_bytes = pcm[offset : offset + take].tobytes()
            is_last = offset + take >= n_samples
            chunks.append(_build_ws_frame_audio(chunk_bytes, is_last=is_last))
            offset += take
        if not chunks:
            pad = np.zeros(CHUNK_SAMPLES, dtype=np.int16)
            chunks = [_build_ws_frame_audio(pad.tobytes(), is_last=True)]

        headers = {
            "X-Api-App-Key": app_key,
            "X-Api-Access-Key": self.access_token,
            "X-Api-Resource-Id": self.resource_id,
            "X-Api-Connect-Id": str(uuid.uuid4()),
        }
        try:
            ws = websocket.create_connection(
                DOUBAO_ASR_WS_URL,
                header=[f"{k}: {v}" for k, v in headers.items()],
                timeout=30,
            )
            ws.send_binary(first_frame)
            for frame in chunks:
                ws.send_binary(frame)
            final_text = ""
            ws.settimeout(15)
            while True:
                try:
                    raw = ws.recv()
                except Exception:
                    break
                if raw is None:
                    break
                if isinstance(raw, str):
                    raw = raw.encode("utf-8")
                msg_type, payload = _parse_ws_response(raw)
                if msg_type == MSG_ERROR:
                    code = struct.unpack(">I", raw[4:8])[0] if len(raw) >= 8 else 0
                    err_size = struct.unpack(">I", raw[8:12])[0] if len(raw) >= 12 else 0
                    err_msg = raw[12:12 + err_size].decode("utf-8", errors="replace") if err_size else ""
                    ws.close()
                    raise RuntimeError(f"豆包 ASR 错误: {code} {err_msg}")
                if msg_type == MSG_FULL_SERVER_RESPONSE and payload:
                    res = payload.get("result") or {}
                    text = (res.get("text") or "").strip()
                    if text:
                        final_text = text
            ws.close()
            return _postprocess(final_text) if final_text else ""
        except Exception as e:
            if "websocket" in str(type(e).__name__).lower():
                raise RuntimeError(f"豆包 ASR 连接异常: {e}") from e
            raise


# ---------------------------------------------------------------------------
# STTEngine (Whisper)
# ---------------------------------------------------------------------------

class STTEngine:
    """Speech-to-text engine using faster-whisper."""

    # Temperature schedule: start deterministic, one retry at 0.2 if uncertain.
    # Keeping this short (2 values) reduces worst-case latency by ~40%.
    TEMPERATURE_FALLBACK = [0.0, 0.2]

    def __init__(self, model_size: str = "base", language: str = "zh"):
        self.model_size = model_size
        self.language = language          # "zh", "en", "auto", …
        self._model = None
        self._lock = threading.Lock()
        self._loading = False

    @staticmethod
    def _best_device() -> tuple[str, str]:
        """Auto-detect best inference device."""
        try:
            import torch
            if torch.cuda.is_available():
                return "cuda", "float16"
        except ImportError:
            pass
        return "cpu", "int8"

    def load_model(self):
        with self._lock:
            if self._model is not None:
                return
            self._loading = True
            try:
                from faster_whisper import WhisperModel
                device, compute_type = self._best_device()
                self._model = WhisperModel(
                    self.model_size,
                    device=device,
                    compute_type=compute_type,
                )
            finally:
                self._loading = False

    def change_model(self, model_size: str):
        if model_size == self.model_size and self._model is not None:
            return
        with self._lock:
            self._model = None
            self.model_size = model_size
        self.load_model()

    def transcribe(self, audio: np.ndarray, sample_rate: int = 16000,
                   position: str = "后端开发", language: str = "Python") -> str:
        if self._model is None:
            self.load_model()

        audio_f = audio.astype(np.float32)
        if audio_f.max() > 1.0:
            audio_f = audio_f / 32768.0

        # "auto" → None lets Whisper auto-detect language per segment
        whisper_lang: Optional[str] = None if self.language in ("auto", "zh-en") else self.language

        initial_prompt = _build_initial_prompt(position, language)

        # Build hotwords from vocabulary banks.
        # hotwords only boost beam-search scores and CANNOT cause hallucination,
        # so we can safely include many terms here.
        hotwords_list = []
        for key in ["通用", language, position]:
            v = TECH_VOCAB.get(key)
            if v:
                for w in v.split():
                    if w and any(c.isascii() and c.isalpha() for c in w):
                        hotwords_list.append(w)
        # Keep hotwords long enough to cover interview vocab,
        # but cap to avoid excessive decoding overhead.
        hotwords_str = " ".join(dict.fromkeys(hotwords_list))[:900]

        kwargs = dict(
            language=whisper_lang,
            beam_size=3,  # 3 vs 5: ~30% faster, negligible accuracy loss for tech interview speech
            temperature=self.TEMPERATURE_FALLBACK,
            initial_prompt=initial_prompt,
            # CRITICAL: False prevents hallucination from propagating across segments
            condition_on_previous_text=False,
            vad_filter=True,
            vad_parameters=dict(
                min_silence_duration_ms=300,
                speech_pad_ms=200,
            ),
            word_timestamps=False,
            no_speech_threshold=0.6,
            log_prob_threshold=-1.0,
        )

        model = self._model
        if model is None:
            raise RuntimeError("Whisper 模型未成功加载")
        model_any = cast(Any, model)

        try:
            segments, _ = model_any.transcribe(audio_f, hotwords=hotwords_str, **kwargs)
        except TypeError:
            segments, _ = model_any.transcribe(audio_f, **kwargs)

        texts = []
        for seg in segments:
            text = seg.text.strip()
            if not text:
                continue
            # Filter out pure-hallucination: if segment is just vocab words
            # with no_speech_prob > 0.5, skip it
            if hasattr(seg, "no_speech_prob") and seg.no_speech_prob > 0.5:
                continue
            texts.append(text)

        return _postprocess(" ".join(texts))

    @property
    def is_loaded(self) -> bool:
        return self._model is not None

    @property
    def is_loading(self) -> bool:
        return self._loading


_engine: Optional[STTEngine] = None
_doubao_engine: Optional[DoubaoSTT] = None


def set_whisper_language(language: str) -> None:
    global _engine
    if _engine is not None:
        _engine.language = language


def get_stt_engine(
    model_size: Optional[str] = None,
    language: Optional[str] = None,
):
    """返回当前配置对应的 STT 引擎：whisper（本地）或 doubao（豆包 API）。"""
    from core.config import get_config
    cfg = get_config()
    if cfg.stt_provider == "doubao":
        global _doubao_engine
        if _doubao_engine is None or (
            _doubao_engine.app_id != cfg.doubao_stt_app_id
            or _doubao_engine.access_token != cfg.doubao_stt_access_token
            or _doubao_engine.resource_id != cfg.doubao_stt_resource_id
            or _doubao_engine.boosting_table_id != (cfg.doubao_stt_boosting_table_id or "")
        ):
            _doubao_engine = DoubaoSTT(
                app_id=cfg.doubao_stt_app_id,
                access_token=cfg.doubao_stt_access_token,
                resource_id=cfg.doubao_stt_resource_id or "volc.seedasr.sauc.duration",
                boosting_table_id=cfg.doubao_stt_boosting_table_id or "",
            )
        return _doubao_engine
    global _engine
    size = model_size if model_size is not None else cfg.whisper_model
    lang = language if language is not None else cfg.whisper_language
    if _engine is None:
        _engine = STTEngine(model_size=size, language=lang)
    elif _engine.model_size != size:
        _engine.change_model(size)
    if _engine.language != lang:
        _engine.language = lang
    return _engine
