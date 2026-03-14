"""Speech-to-text using faster-whisper.

Key improvements over naïve usage:
- language="auto"  → passes language=None to Whisper so it auto-detects
  Chinese + English mixed speech.  This is the most impactful fix for English
  technical term recognition.
- temperature fallback  → [0, 0.2, 0.4] lets Whisper retry with higher
  entropy when greedy decoding fails on accented / unclear speech.
- initial_prompt demonstrates the target output style with English terms
  written out verbatim, biasing the decoder toward correct spellings.
- hotwords  → bonus boost for critical tech terms (faster-whisper ≥ 1.1).
"""

import re
import numpy as np
import threading
from typing import Optional

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
}

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_t2s_converter = None


def _get_t2s_converter():
    global _t2s_converter
    if _t2s_converter is None:
        try:
            import opencc
            _t2s_converter = opencc.OpenCC("t2s")
        except ImportError:
            _t2s_converter = False
    return _t2s_converter


def _build_initial_prompt(position: str, language: str) -> str:
    """Short demonstration prompt for Whisper.

    IMPORTANT: keep this SHORT (~100 chars). Long prompts cause Whisper to
    "hallucinate" words from the prompt instead of transcribing actual audio.
    The bulk of vocabulary guidance goes into hotwords (no hallucination risk).
    """
    return "这是一段中文技术面试对话，术语保留英文，如Redis、MySQL、Docker、API。"


def _postprocess(text: str) -> str:
    converter = _get_t2s_converter()
    if converter and converter is not False:
        text = converter.convert(text)
    for pattern, replacement in TERM_CORRECTIONS.items():
        text = re.sub(pattern, replacement, text)
    return text.strip()


# ---------------------------------------------------------------------------
# STTEngine
# ---------------------------------------------------------------------------

class STTEngine:
    """Speech-to-text engine using faster-whisper."""

    # Temperature schedule: start deterministic (0), fall back to higher
    # values if Whisper is uncertain (handles accented / unclear speech).
    TEMPERATURE_FALLBACK = [0.0, 0.2, 0.4, 0.6]

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
        hotwords_str = " ".join(dict.fromkeys(hotwords_list))[:500]

        kwargs = dict(
            language=whisper_lang,
            beam_size=5,
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

        try:
            segments, _ = self._model.transcribe(audio_f, hotwords=hotwords_str, **kwargs)
        except TypeError:
            segments, _ = self._model.transcribe(audio_f, **kwargs)

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


def get_stt_engine(model_size: str = "base", language: str = "zh") -> STTEngine:
    global _engine
    if _engine is None:
        _engine = STTEngine(model_size=model_size, language=language)
    return _engine
