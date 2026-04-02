"""STT text processing: vocabulary banks, normalization, ASR question classification."""

import re
from typing import Optional, Literal

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
# Traditional-to-Simplified Chinese converter
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


# ---------------------------------------------------------------------------
# CJK slow-speech punctuation normalization
# ---------------------------------------------------------------------------

_CJK = r"\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff"

_PAT_CJK_COMMA_FW = re.compile(rf"([{_CJK}])，([{_CJK}])")
_PAT_CJK_COMMA_ASCII = re.compile(rf"([{_CJK}]),([{_CJK}])")
_PAT_CJK_PERIOD_FW = re.compile(rf"([{_CJK}])。([{_CJK}])")
_PAT_CJK_PERIOD_ASCII = re.compile(rf"([{_CJK}])\.([{_CJK}])")


def _normalize_slow_speech_intraword_punct(text: str) -> str:
    """Remove erroneous intra-word punctuation from slow-speech ASR output."""
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


_normalize_slow_speech_commas = _normalize_slow_speech_intraword_punct


def _postprocess(text: str) -> str:
    """Apply term corrections, t2s conversion, and slow-speech normalization."""
    converter = _get_t2s_converter()
    if converter and converter is not False:
        text = converter.convert(text)
    for pattern, replacement in TERM_CORRECTIONS.items():
        text = re.sub(pattern, replacement, text)
    text = _normalize_slow_speech_intraword_punct(text)
    return text.strip()


def _build_initial_prompt(position: str, language: str) -> str:
    """Short demonstration prompt for Whisper (keep ~100 chars to avoid hallucination)."""
    return (
        "这是一段技术面试语音，可能中英混说且口音不标准。"
        "请优先识别技术术语英文原词，如 Redis、ZSET、Sorted Set、MySQL、Docker、Kubernetes、API。"
    )


# ---------------------------------------------------------------------------
# Transcription text utilities
# ---------------------------------------------------------------------------

def transcription_significant_len(text: str) -> int:
    if not text:
        return 0
    return len(re.findall(rf"[{_CJK}A-Za-z0-9]", text))


def transcription_for_publish(text: str, min_significant_chars: int = 2) -> Optional[str]:
    t = (text or "").strip()
    if not t:
        return None
    need = max(1, int(min_significant_chars))
    if transcription_significant_len(t) < need:
        return None
    return t


def join_transcription_fragments(parts: list[str]) -> str:
    qs = [p.strip() for p in parts if p and str(p).strip()]
    if not qs:
        return ""
    acc = qs[0]
    for q in qs[1:]:
        need_space = bool(re.search(r"[a-zA-Z0-9]$", acc) and re.match(r"^[a-zA-Z0-9]", q))
        acc = f"{acc} {q}" if need_space else f"{acc}{q}"
    return acc.strip()


# ---------------------------------------------------------------------------
# ASR question classification
# ---------------------------------------------------------------------------

_FILLER_PREFIX = re.compile(
    r"^(?:"
    r"嗯+|恩+|啊+|呃+|额+|诶+|欸+|唉+|"
    r"那个|这个|就是|然后|所以|"
    r"我想想|让我想想|等一下|等会|等会儿|稍等"
    r")(?:[\s,，。.!！?？;；:：、]+|$)",
    re.IGNORECASE,
)
_BACKCHANNEL = re.compile(
    r"^(?:"
    r"对+|对对+|没错|是的|好|好的|行|可以|嗯+|恩+|啊+|哦+|噢+|"
    r"明白了|知道了|收到|你说得对|你说的对|确实|继续|继续吧|然后呢|还有吗"
    r")(?:[\s,，。.!！?？;；:：、]+|$)",
    re.IGNORECASE,
)
_QUESTION_CUE = re.compile(
    r"(什么|怎么|如何|为什么|为何|区别|原理|作用|流程|实现|设计|优化|排查|处理|"
    r"介绍(?:一下|下)?|说(?:一下|下)?|讲(?:一下|下)?|聊(?:一下|下)?|解释(?:一下|下)?|"
    r"分析(?:一下|下)?|怎么做|怎么办|有哪些|是否|能不能|可不可以|对比(?:一下|下)?|"
    r"展开讲讲|详细说说|举个例子|继续讲|接着说)",
    re.IGNORECASE,
)
_DIRECTIVE_QUESTION_CUE = re.compile(
    r"(?:请|你|麻烦|帮我|能否|能不能|可不可以).{0,24}"
    r"(?:介绍|说|讲|聊|解释|分析|设计|实现|排查|优化|比较|总结|展开)(?:一下|下)?",
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

AsrQuestionCandidate = Literal["ignore", "candidate", "promote"]


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


def is_backchannel_text(text: str) -> bool:
    normalized = normalize_transcription_for_analysis(text)
    if not normalized:
        return True
    normalized = re.sub(r"^(?:嗯+|恩+|啊+|呃+|额+|诶+|欸+|哦+|噢+)", "", normalized).strip()
    if not normalized:
        return True
    return bool(_BACKCHANNEL.fullmatch(normalized))


def classify_asr_question_candidate(
    text: str,
    min_significant_chars: int = 4,
) -> tuple[AsrQuestionCandidate, str]:
    normalized = normalize_transcription_for_analysis(text)
    if not normalized:
        return "ignore", ""
    backchannel_cleaned = re.sub(r"^(?:嗯+|恩+|啊+|呃+|额+|诶+|欸+|哦+|噢+)", "", normalized).strip()
    if is_backchannel_text(normalized):
        return "ignore", backchannel_cleaned or normalized
    sig = transcription_significant_len(normalized)
    need = max(2, int(min_significant_chars))
    has_question_mark = "?" in text or "？" in text
    has_question_cue = bool(_QUESTION_CUE.search(normalized))
    has_directive_cue = bool(_DIRECTIVE_QUESTION_CUE.search(normalized))
    has_tail_question = bool(re.search(r"(?:吗|么|呢)$", normalized))
    incomplete_tail = bool(_INCOMPLETE_TAIL.search(normalized))
    if has_question_mark and sig >= 2:
        return "promote", normalized
    if has_question_cue or has_directive_cue:
        return "promote", normalized
    if has_tail_question and sig >= max(3, need - 1):
        return "promote", normalized
    if incomplete_tail:
        if sig >= need:
            return "candidate", normalized
        return "ignore", normalized
    if sig >= max(5, need + 1):
        return "candidate", normalized
    return "ignore", normalized


def is_viable_asr_question_group(
    texts: list[str],
    min_significant_chars: int = 4,
) -> bool:
    cleaned_parts: list[str] = []
    saw_promote = False
    for text in texts:
        parts = split_question_like_text(text) or [normalize_transcription_for_analysis(text)]
        for part in parts:
            if not part:
                continue
            kind, cleaned = classify_asr_question_candidate(part, min_significant_chars)
            if cleaned:
                cleaned_parts.append(cleaned)
            if kind == "promote":
                saw_promote = True
    if saw_promote:
        return True
    if len(cleaned_parts) >= 2:
        return True
    merged = "".join(cleaned_parts)
    return transcription_significant_len(merged) >= max(6, int(min_significant_chars) + 1)


def build_asr_question_group_text(texts: list[str], max_items: int = 4) -> str:
    items: list[str] = []
    for text in texts:
        parts = split_question_like_text(text) or [normalize_transcription_for_analysis(text)]
        for part in parts:
            if not part:
                continue
            if not items or items[-1] != part:
                items.append(part)
    if not items:
        return ""
    if len(items) == 1:
        return items[0]
    if len(items) > max_items:
        items = [items[0], *items[-(max_items - 1):]]
    followups = "\n".join(f"{idx}. {item}" for idx, item in enumerate(items[1:], start=1))
    return (
        "以下内容来自同一轮实时面试中的连续追问，请合并理解，优先回答最后一个追问，并兼顾前文上下文。\n\n"
        f"主问题：{items[0]}\n\n"
        f"连续追问：\n{followups}"
    )
