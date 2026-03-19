"""实时辅助 Tab：录音、转写、问答、会话状态。"""

from api.assist.router import router, stop_interview_loop

__all__ = ["router", "stop_interview_loop"]
