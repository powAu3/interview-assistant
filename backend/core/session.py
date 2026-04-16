import time
import threading
from typing import Optional, Union
from dataclasses import asdict, dataclass, field


@dataclass
class QAPair:
    id: str
    question: str
    answer: str
    timestamp: float = field(default_factory=time.time)
    source: str = ""
    model_name: str = ""


@dataclass
class Session:
    transcription_history: list[str] = field(default_factory=list)
    conversation_history: list[dict] = field(default_factory=list)
    qa_pairs: list[QAPair] = field(default_factory=list)
    current_transcription: str = ""
    is_recording: bool = False
    is_paused: bool = False
    last_device_id: int = 0
    capture_is_loopback: bool = True
    created_at: float = field(default_factory=time.time)

    MAX_HISTORY = 20
    MAX_TRANSCRIPTION_HISTORY = 200
    MAX_QA_PAIRS = 80
    CONVERSATION_TURNS_FOR_LLM = 6
    MAX_CHARS_PER_MESSAGE = 2000

    def add_transcription(self, text: str):
        if text.strip():
            self.transcription_history.append(text.strip())
            self.current_transcription = text.strip()
            if len(self.transcription_history) > self.MAX_TRANSCRIPTION_HISTORY:
                self.transcription_history = self.transcription_history[-self.MAX_TRANSCRIPTION_HISTORY:]

    def add_user_message(self, content: Union[str, list]):
        self.conversation_history.append({"role": "user", "content": content})
        self._trim_history()

    def add_assistant_message(self, content: str):
        self.conversation_history.append({"role": "assistant", "content": content})
        self._trim_history()

    def add_qa(
        self,
        question: str,
        answer: str,
        qa_id: Optional[str] = None,
        source: str = "",
        model_name: str = "",
    ) -> QAPair:
        qa = QAPair(
            id=qa_id or f"qa-{len(self.qa_pairs)}-{int(time.time())}",
            question=question,
            answer=answer,
            source=source,
            model_name=model_name,
        )
        self.qa_pairs.append(qa)
        if len(self.qa_pairs) > self.MAX_QA_PAIRS:
            self.qa_pairs = self.qa_pairs[-self.MAX_QA_PAIRS:]
        return qa

    def get_conversation_messages(self) -> list[dict]:
        return list(self.conversation_history)

    def get_conversation_messages_for_llm(self) -> list[dict]:
        """最近 N 轮对话，每条 content 截断到 max_chars，用于控制 token。"""
        n = self.CONVERSATION_TURNS_FOR_LLM * 2
        recent = self.conversation_history[-n:] if len(self.conversation_history) > n else self.conversation_history
        out = []
        for msg in recent:
            content = msg.get("content")
            if isinstance(content, list):
                out.append(msg)
                continue
            if isinstance(content, str) and len(content) > self.MAX_CHARS_PER_MESSAGE:
                content = content[-self.MAX_CHARS_PER_MESSAGE:].strip()
                content = "…" + content
                out.append({"role": msg["role"], "content": content})
            else:
                out.append(dict(msg))
        return out

    def get_last_qa(self) -> Optional['QAPair']:
        return self.qa_pairs[-1] if self.qa_pairs else None

    def get_recent_transcription(self, n: int = 10) -> str:
        recent = self.transcription_history[-n:]
        return "\n".join(recent)

    def _trim_history(self):
        if len(self.conversation_history) > self.MAX_HISTORY:
            self.conversation_history = self.conversation_history[-self.MAX_HISTORY:]

    def clear(self):
        self.transcription_history.clear()
        self.conversation_history.clear()
        self.qa_pairs.clear()
        self.current_transcription = ""
        self.is_recording = False
        self.is_paused = False
        self.last_device_id = 0
        self.capture_is_loopback = True
        self.created_at = time.time()

    def snapshot(self) -> dict:
        return {
            "is_recording": self.is_recording,
            "is_paused": self.is_paused,
            "transcriptions": list(self.transcription_history[-50:]),
            "qa_pairs": [
                {
                    **asdict(qa),
                    "source": getattr(qa, "source", "") or "",
                    "model_name": getattr(qa, "model_name", "") or "",
                }
                for qa in self.qa_pairs
            ],
        }


_session: Optional[Session] = None
_lock = threading.Lock()
# 并行答题时对 conversation_history / qa_pairs 的写入需串行
conversation_lock = threading.RLock()


def get_session() -> Session:
    global _session
    with _lock:
        if _session is None:
            _session = Session()
        return _session


def snapshot_session() -> dict:
    with conversation_lock:
        session = get_session()
        return session.snapshot()


def reset_session() -> Session:
    with conversation_lock:
        session = get_session()
        session.clear()
        return session
