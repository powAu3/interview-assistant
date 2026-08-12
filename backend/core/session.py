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
    vision_verify_verdict: str = ""
    vision_verify_reason: str = ""


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
    last_llm_history_stats: dict = field(default_factory=dict)
    is_recording: bool = False
    is_paused: bool = False
    # PortAudio device ids are 0-based; use -1 as the unset / no-device sentinel.
    last_device_id: int = -1
    last_candidate_mic_device_id: int = -1
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
            for _idx, seg in enumerate(self.candidate_answer_segments):
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
        cleaned, _ = self._strip_images_from_content(content)
        self.conversation_history.append({"role": "user", "content": cleaned})
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

    def set_vision_verify(self, qa_id: str, verdict: str, reason: str = "") -> bool:
        target = (qa_id or "").strip()
        if not target:
            return False
        normalized = (verdict or "UNKNOWN").strip().upper()
        if normalized not in ("PASS", "FAIL", "UNKNOWN"):
            normalized = "UNKNOWN"
        for qa in self.qa_pairs:
            if qa.id == target:
                qa.vision_verify_verdict = normalized
                qa.vision_verify_reason = (reason or "").strip()
                return True
        return False

    def get_conversation_messages(self) -> list[dict]:
        return list(self.conversation_history)

    def get_conversation_messages_for_llm(
        self,
        *,
        turns: Optional[int] = None,
        max_chars_per_message: Optional[int] = None,
        include_summary: bool = True,
        total_char_budget: Optional[int] = None,
        profile: str = "default",
    ) -> list[dict]:
        turn_count = self.CONVERSATION_TURNS_FOR_LLM if turns is None else max(0, int(turns))
        n = turn_count * 2
        recent = [] if n == 0 else (
            self.conversation_history[-n:] if len(self.conversation_history) > n else self.conversation_history
        )
        out: list[dict] = []
        stripped_images = 0
        raw_text_chars = 0
        trimmed_text_chars = 0
        max_chars = (
            self.MAX_CHARS_PER_MESSAGE
            if max_chars_per_message is None
            else max(120, int(max_chars_per_message))
        )
        if include_summary and self.system_summary:
            out.append({
                "role": "system",
                "content": (
                    "以下是之前面试中已经发生的问答的滚动摘要(由系统压缩,仅供你了解上下文,"
                    "不要复读它):\n" + self.system_summary
                ),
            })
        for msg in recent:
            content, msg_stripped = self._strip_images_from_content(msg.get("content"))
            stripped_images += msg_stripped
            if isinstance(content, str):
                raw_text_chars += len(content)
            if isinstance(content, str) and len(content) > max_chars:
                content = content[-max_chars:].strip()
                content = "…" + content
            if isinstance(content, str):
                trimmed_text_chars += len(content)
            out.append({"role": msg["role"], "content": content})
        if total_char_budget and total_char_budget > 0:
            budget = int(total_char_budget)
            kept: list[dict] = []
            used = 0
            for msg in reversed(out):
                content = msg.get("content")
                msg_len = len(content) if isinstance(content, str) else 0
                if msg_len and used + msg_len > budget:
                    remaining = max(0, budget - used)
                    if remaining >= 160:
                        kept.append({"role": msg["role"], "content": "…" + content[-remaining:].strip()})
                    continue
                kept.append(msg)
                used += msg_len
            out = list(reversed(kept))
            trimmed_text_chars = min(trimmed_text_chars, budget)
        self.last_llm_history_stats = {
            "messages": len(out),
            "history_messages": len(recent),
            "stripped_images": stripped_images,
            "profile": profile,
            "raw_text_chars": raw_text_chars,
            "trimmed_text_chars": trimmed_text_chars,
            "max_chars_per_message": max_chars,
            "total_char_budget": int(total_char_budget or 0),
        }
        return out

    def _strip_images_from_content(self, content: Union[str, list, None]) -> tuple[Union[str, list], int]:
        if not isinstance(content, list):
            return content or "", 0
        text_parts: list[str] = []
        stripped_images = 0
        other_parts: list[dict] = []
        for part in content:
            if not isinstance(part, dict):
                continue
            part_type = part.get("type")
            if part_type == "image_url":
                stripped_images += 1
                continue
            if part_type == "text":
                text = str(part.get("text") or "").strip()
                if text:
                    text_parts.append(text)
                continue
            other_parts.append(part)
        if stripped_images:
            summary_text = " ".join(text_parts).strip()
            if not summary_text:
                summary_text = "[历史截图问题]"
            suffix = f" [图片已省略 x{stripped_images}]"
            return summary_text + suffix, stripped_images
        if text_parts and not other_parts:
            return " ".join(text_parts).strip(), 0
        if text_parts and other_parts:
            return [{"type": "text", "text": " ".join(text_parts).strip()}, *other_parts], 0
        return other_parts or "", 0

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
        self.last_device_id = -1
        self.last_candidate_mic_device_id = -1
        self.capture_is_loopback = True
        self.created_at = time.time()
        self.system_summary = ""
        self._compaction_running = False
        self.last_llm_history_stats = {}

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
                self._serialize_qa_pair(qa)
                for qa in self.qa_pairs
            ],
        }

    def _serialize_qa_pair(self, qa: QAPair) -> dict:
        payload = asdict(qa)
        verdict = str(payload.pop("vision_verify_verdict", "") or "")
        reason = str(payload.pop("vision_verify_reason", "") or "")
        payload["source"] = getattr(qa, "source", "") or ""
        payload["model_name"] = getattr(qa, "model_name", "") or ""
        if verdict:
            payload["vision_verify"] = {
                "verdict": verdict,
                "reason": reason,
            }
        return payload


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
