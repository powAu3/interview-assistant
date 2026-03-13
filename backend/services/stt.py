import numpy as np
import threading
from typing import Optional


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

    def transcribe(self, audio: np.ndarray, sample_rate: int = 16000) -> str:
        if self._model is None:
            self.load_model()

        audio_float = audio.astype(np.float32)
        if audio_float.max() > 1.0:
            audio_float = audio_float / 32768.0

        segments, info = self._model.transcribe(
            audio_float,
            language=self.language,
            beam_size=5,
            vad_filter=True,
            vad_parameters=dict(
                min_silence_duration_ms=500,
                speech_pad_ms=200,
            ),
        )
        texts = []
        for seg in segments:
            text = seg.text.strip()
            if text:
                texts.append(text)
        return " ".join(texts)

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
