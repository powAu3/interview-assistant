import re
import numpy as np
import threading
from typing import Optional

TECH_VOCAB = {
    "通用": (
        "API Redis MySQL PostgreSQL MongoDB Nginx Docker Kubernetes HTTP HTTPS "
        "WebSocket TCP UDP JSON XML YAML TOML REST GraphQL gRPC OAuth JWT "
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
    "C++": (
        "C++ STL vector map unordered_map shared_ptr unique_ptr "
        "template 多态 虚函数 析构函数 RAII 智能指针 内存管理 指针 引用"
    ),
    "后端开发": (
        "Redis ZSET SET HASH LIST SORTED SET HyperLogLog 布隆过滤器 "
        "主从复制 哨兵 集群 持久化 RDB AOF 缓存穿透 缓存雪崩 缓存击穿 "
        "MySQL 索引 B+树 事务 MVCC 锁 死锁 分库分表 读写分离 binlog "
        "Kafka RabbitMQ RocketMQ Elasticsearch Zookeeper etcd Consul "
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
        "PyTorch TensorFlow ONNX CUDA 推理 训练 微调 量化 蒸馏"
    ),
    "测试开发": (
        "Selenium Playwright Pytest JMeter 接口测试 性能测试 "
        "自动化测试 持续集成 Mock 断言 测试用例 覆盖率 回归测试"
    ),
}

TERM_CORRECTIONS = {
    r"(?i)radex": "Redis",
    r"(?i)reddis": "Redis",
    r"(?i)redist": "Redis",
    r"(?i)(?<![a-zA-Z])C\s*SET(?![a-zA-Z])": "ZSET",
    r"(?i)(?<![a-zA-Z])Z\s*SET(?![a-zA-Z])": "ZSET",
    r"(?i)my\s*sequel": "MySQL",
    r"(?i)post\s*gre": "Postgre",
    r"(?i)dacker": "Docker",
    r"(?i)kubernetes|k\s*8\s*s": "Kubernetes",
    r"(?i)(?<![a-zA-Z])g\s*i\s*l(?![a-zA-Z])": "GIL",
    r"(?i)fast\s*a\s*p\s*i": "FastAPI",
    r"(?i)web\s*socket": "WebSocket",
    r"(?i)spring\s*boot": "SpringBoot",
    r"(?i)my\s*batis": "MyBatis",
    r"(?i)mongo\s*d\s*b": "MongoDB",
    r"(?i)kafka": "Kafka",
    r"(?i)rabbit\s*m\s*q": "RabbitMQ",
    r"(?i)elastic\s*search": "Elasticsearch",
    r"(?i)ngin\s*x|engine\s*x": "Nginx",
    r"(?i)pie\s*test|pie\s*tests": "Pytest",
    r"(?i)pie\s*torch": "PyTorch",
    r"(?i)tensor\s*flow": "TensorFlow",
    r"(?i)git\s*hub": "GitHub",
}

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
    parts = ["以下是一段简体中文的技术面试对话。"]
    for key in ["通用", language, position]:
        vocab = TECH_VOCAB.get(key)
        if vocab:
            parts.append(vocab)
    return " ".join(parts)


def _postprocess(text: str) -> str:
    converter = _get_t2s_converter()
    if converter and converter is not False:
        text = converter.convert(text)

    for pattern, replacement in TERM_CORRECTIONS.items():
        text = re.sub(pattern, replacement, text)

    return text


class STTEngine:
    """Speech-to-text engine using faster-whisper for local transcription."""

    def __init__(self, model_size: str = "base", language: str = "zh"):
        self.model_size = model_size
        self.language = language
        self._model = None
        self._lock = threading.Lock()
        self._loading = False

    def load_model(self):
        with self._lock:
            if self._model is not None:
                return
            self._loading = True
            try:
                from faster_whisper import WhisperModel
                self._model = WhisperModel(
                    self.model_size,
                    device="cpu",
                    compute_type="int8",
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

        audio_float = audio.astype(np.float32)
        if audio_float.max() > 1.0:
            audio_float = audio_float / 32768.0

        initial_prompt = _build_initial_prompt(position, language)

        segments, info = self._model.transcribe(
            audio_float,
            language=self.language,
            beam_size=5,
            vad_filter=True,
            vad_parameters=dict(
                min_silence_duration_ms=500,
                speech_pad_ms=200,
            ),
            initial_prompt=initial_prompt,
        )
        texts = []
        for seg in segments:
            text = seg.text.strip()
            if text:
                texts.append(text)

        raw = " ".join(texts)
        return _postprocess(raw)

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
