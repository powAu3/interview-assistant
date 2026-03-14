import time
import threading
from typing import Optional, Union
from dataclasses import dataclass, field


@dataclass
class QAPair:
    id: str
    question: str
    answer: str
    timestamp: float = field(default_factory=time.time)


@dataclass
class Session:
    transcription_history: list[str] = field(default_factory=list)
    conversation_history: list[dict] = field(default_factory=list)
    qa_pairs: list[QAPair] = field(default_factory=list)
    current_transcription: str = ""
    is_recording: bool = False
    is_paused: bool = False
    last_device_id: int = 0
    created_at: float = field(default_factory=time.time)

    MAX_HISTORY = 20

    def add_transcription(self, text: str):
        if text.strip():
            self.transcription_history.append(text.strip())
            self.current_transcription = text.strip()

    def add_user_message(self, content: Union[str, list]):
        self.conversation_history.append({"role": "user", "content": content})
        self._trim_history()

    def add_assistant_message(self, content: str):
        self.conversation_history.append({"role": "assistant", "content": content})
        self._trim_history()

    def add_qa(self, question: str, answer: str) -> QAPair:
        qa = QAPair(
            id=f"qa-{len(self.qa_pairs)}-{int(time.time())}",
            question=question,
            answer=answer,
        )
        self.qa_pairs.append(qa)
        return qa

    def get_conversation_messages(self) -> list[dict]:
        return list(self.conversation_history)

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


_session: Optional[Session] = None
_lock = threading.Lock()


def get_session() -> Session:
    global _session
    with _lock:
        if _session is None:
            _session = Session()
        return _session


def reset_session() -> Session:
    global _session
    with _lock:
        _session = Session()
        return _session
