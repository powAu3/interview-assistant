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
class CandidateAnswerSegment:
    text: str
    timestamp: float = field(default_factory=time.time)
    qa_id: str = ""
    provider: str = ""
    segment_id: str = ""
    is_final: bool = True


@dataclass
class Session:
    transcription_history: list[str] = field(default_factory=list)
    candidate_transcription_history: list[str] = field(default_factory=list)
    candidate_answer_segments: list[CandidateAnswerSegment] = field(default_factory=list)
    conversation_history: list[dict] = field(default_factory=list)
    qa_pairs: list[QAPair] = field(default_factory=list)
    current_transcription: str = ""
    current_candidate_transcription: str = ""
    current_candidate_qa_id: str = ""
    candidate_asr_busy: bool = False
    candidate_asr_active_qa_id: str = ""
    candidate_asr_activity_at: float = 0.0
    is_recording: bool = False
    is_paused: bool = False
    last_device_id: int = 0
    last_candidate_mic_device_id: int = 0
    capture_is_loopback: bool = True
    created_at: float = field(default_factory=time.time)
    system_summary: str = ""
    _compaction_running: bool = False

    MAX_HISTORY = 20
    MAX_TRANSCRIPTION_HISTORY = 200
    MAX_CANDIDATE_TRANSCRIPTION_HISTORY = 200
    MAX_CANDIDATE_SEGMENTS = 120
    MAX_QA_PAIRS = 80
    CONVERSATION_TURNS_FOR_LLM = 6
    SCREEN_TURNS_FOR_LLM = 2
    MAX_CHARS_PER_MESSAGE = 2000
    # 滚动摘要触发阈值:超过此条数后台压缩一次
    SUMMARY_TRIGGER = 12
    # 摘要后保留最近 N 条原文(必须为偶数,代表完整轮数 * 2)
    SUMMARY_KEEP_RECENT = 4

    def add_transcription(self, text: str):
        if text.strip():
            self.transcription_history.append(text.strip())
            self.current_transcription = text.strip()
            if len(self.transcription_history) > self.MAX_TRANSCRIPTION_HISTORY:
                self.transcription_history = self.transcription_history[-self.MAX_TRANSCRIPTION_HISTORY:]

    def add_candidate_transcription(
        self,
        text: str,
        *,
        qa_id: Optional[str] = None,
        provider: str = "",
        segment_id: str = "",
        is_final: bool = True,
    ) -> Optional[CandidateAnswerSegment]:
        cleaned = (text or "").strip()
        if not cleaned:
            return None
        self.current_candidate_transcription = cleaned
        segment_key = (segment_id or "").strip()
        if segment_key:
            for idx, seg in enumerate(self.candidate_answer_segments):
                if seg.segment_id == segment_key:
                    seg.text = cleaned
                    seg.timestamp = time.time()
                    seg.qa_id = (qa_id if qa_id is not None else seg.qa_id or self.current_candidate_qa_id) or ""
                    seg.provider = provider or seg.provider
                    seg.is_final = bool(is_final)
                    if self.candidate_transcription_history:
                        self.candidate_transcription_history[-1] = cleaned
                    else:
                        self.candidate_transcription_history.append(cleaned)
                    return seg
        self.candidate_transcription_history.append(cleaned)
        if len(self.candidate_transcription_history) > self.MAX_CANDIDATE_TRANSCRIPTION_HISTORY:
            self.candidate_transcription_history = self.candidate_transcription_history[-self.MAX_CANDIDATE_TRANSCRIPTION_HISTORY:]
        segment = CandidateAnswerSegment(
            text=cleaned,
            qa_id=(qa_id if qa_id is not None else self.current_candidate_qa_id) or "",
            provider=provider or "",
            segment_id=segment_key,
            is_final=bool(is_final),
        )
        self.candidate_answer_segments.append(segment)
        if len(self.candidate_answer_segments) > self.MAX_CANDIDATE_SEGMENTS:
            self.candidate_answer_segments = self.candidate_answer_segments[-self.MAX_CANDIDATE_SEGMENTS:]
        return segment

    def open_candidate_answer_window(self, qa_id: str):
        self.current_candidate_qa_id = (qa_id or "").strip()

    def close_candidate_answer_window(self):
        self.current_candidate_qa_id = ""

    def mark_candidate_asr_busy(self, qa_id: str = ""):
        self.candidate_asr_busy = True
        self.candidate_asr_active_qa_id = (
            qa_id or self.candidate_asr_active_qa_id or self.current_candidate_qa_id or ""
        ).strip()
        self.candidate_asr_activity_at = time.time()

    def mark_candidate_asr_idle(self):
        self.candidate_asr_busy = False
        self.candidate_asr_active_qa_id = ""
        self.candidate_asr_activity_at = time.time()

    def has_candidate_asr_pending_for_qa(self, qa_id: str, stale_after_sec: float = 8.0) -> bool:
        target = (qa_id or "").strip()
        if not target or not self.candidate_asr_busy:
            return False
        if self.candidate_asr_active_qa_id != target:
            return False
        if stale_after_sec > 0 and self.candidate_asr_activity_at:
            return time.time() - self.candidate_asr_activity_at <= stale_after_sec
        return True

    def get_candidate_answer_for_qa(self, qa_id: str, max_chars: int = 1200) -> str:
        target = (qa_id or "").strip()
        if not target:
            return ""
        parts = [
            seg.text.strip()
            for seg in self.candidate_answer_segments
            if seg.qa_id == target and seg.text.strip()
        ]
        text = "\n".join(parts).strip()
        if len(text) > max_chars:
            text = "…" + text[-max_chars:].strip()
        return text

    def add_user_message(self, content: Union[str, list]):
        self.conversation_history.append({"role": "user", "content": content})
        self._trim_history()
        self._maybe_compact()

    def add_assistant_message(self, content: str):
        self.conversation_history.append({"role": "assistant", "content": content})
        self._trim_history()
        self._maybe_compact()

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
        n = self.CONVERSATION_TURNS_FOR_LLM * 2
        recent = self.conversation_history[-n:] if len(self.conversation_history) > n else self.conversation_history
        out: list[dict] = []
        if self.system_summary:
            out.append({
                "role": "system",
                "content": (
                    "以下是之前面试中已经发生的问答的滚动摘要(由系统压缩,仅供你了解上下文,"
                    "不要复读它):\n" + self.system_summary
                ),
            })
        screen_count = sum(
            1 for msg in recent
            if isinstance(msg.get("content"), list)
        )
        screen_limit = self.SCREEN_TURNS_FOR_LLM * 2
        if screen_count > screen_limit:
            screen_seen = 0
            filtered: list[dict] = []
            for msg in reversed(recent):
                if isinstance(msg.get("content"), list):
                    screen_seen += 1
                    if screen_seen > screen_limit:
                        text_parts = [
                            p.get("text", "") for p in msg["content"]
                            if isinstance(p, dict) and p.get("type") == "text"
                        ]
                        summary_text = " ".join(text_parts).strip()
                        if summary_text:
                            filtered.append({"role": msg["role"], "content": f"[之前截图问题: {summary_text[:200]}]"})
                        else:
                            filtered.append({"role": msg["role"], "content": "[之前截图问题(已省略图片)]"})
                        continue
                filtered.append(msg)
            recent = list(reversed(filtered))
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

    def _maybe_compact(self):
        """超过软阈值后,异步触发一次摘要压缩。绝不阻塞当前调用。"""
        if len(self.conversation_history) <= self.SUMMARY_TRIGGER:
            return
        if self._compaction_running:
            return
        try:
            from services.memory import schedule_compaction
        except Exception:
            return
        try:
            schedule_compaction(self)
        except Exception:
            self._compaction_running = False

    def clear(self):
        self.transcription_history.clear()
        self.candidate_transcription_history.clear()
        self.candidate_answer_segments.clear()
        self.conversation_history.clear()
        self.qa_pairs.clear()
        self.current_transcription = ""
        self.current_candidate_transcription = ""
        self.current_candidate_qa_id = ""
        self.candidate_asr_busy = False
        self.candidate_asr_active_qa_id = ""
        self.candidate_asr_activity_at = 0.0
        self.is_recording = False
        self.is_paused = False
        self.last_device_id = 0
        self.last_candidate_mic_device_id = 0
        self.capture_is_loopback = True
        self.created_at = time.time()
        self.system_summary = ""
        self._compaction_running = False

    def snapshot(self) -> dict:
        return {
            "is_recording": self.is_recording,
            "is_paused": self.is_paused,
            "transcriptions": list(self.transcription_history[-50:]),
            "candidate_transcriptions": list(self.candidate_transcription_history[-50:]),
            "candidate_answer_segments": [
                asdict(seg) for seg in self.candidate_answer_segments[-50:]
            ],
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
