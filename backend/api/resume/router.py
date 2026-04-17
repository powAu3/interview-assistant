import threading
from fastapi import APIRouter
from pydantic import BaseModel
from services.resume_optimizer import optimize_resume_stream
from services.llm import get_token_stats
from api.realtime.ws import broadcast


router = APIRouter()


class OptimizeRequest(BaseModel):
    jd: str


@router.post("/resume/optimize")
async def api_resume_optimize(body: OptimizeRequest):
    threading.Thread(target=_run_optimize, args=(body.jd,), daemon=True).start()
    return {"ok": True}


def _run_optimize(jd: str):
    broadcast({"type": "resume_opt_start", "scope": "resume-opt"})
    full_text = ""
    try:
        for chunk in optimize_resume_stream(jd):
            full_text += chunk
            broadcast({"type": "resume_opt_chunk", "chunk": chunk, "scope": "resume-opt"})
    except Exception as e:
        full_text += f"\n\n[错误: {e}]"
        broadcast({"type": "resume_opt_chunk", "chunk": f"\n\n[错误: {e}]", "scope": "resume-opt"})
    try:
        broadcast({"type": "resume_opt_done", "text": full_text, "scope": "resume-opt"})
        stats = get_token_stats()
        broadcast({
            "type": "token_update",
            "prompt": stats["prompt"],
            "completion": stats["completion"],
            "total": stats["total"],
            "by_model": stats.get("by_model", {}),
        })
    except Exception:
        pass  # ws 可能已断开，仅忽略避免 daemon 线程抛错
