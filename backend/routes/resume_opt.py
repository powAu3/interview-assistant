import threading
from fastapi import APIRouter
from pydantic import BaseModel
from services.resume_optimizer import optimize_resume_stream
from services.llm import _token_stats
from routes.ws import broadcast


router = APIRouter()


class OptimizeRequest(BaseModel):
    jd: str


@router.post("/resume/optimize")
async def api_resume_optimize(body: OptimizeRequest):
    threading.Thread(target=_run_optimize, args=(body.jd,), daemon=True).start()
    return {"ok": True}


def _run_optimize(jd: str):
    broadcast({"type": "resume_opt_start"})
    full_text = ""
    try:
        for chunk in optimize_resume_stream(jd):
            full_text += chunk
            broadcast({"type": "resume_opt_chunk", "chunk": chunk})
    except Exception as e:
        broadcast({"type": "resume_opt_chunk", "chunk": f"\n\n[错误: {e}]"})
    broadcast({"type": "resume_opt_done", "text": full_text})
    broadcast({
        "type": "token_update",
        "prompt": _token_stats["prompt"],
        "completion": _token_stats["completion"],
        "total": _token_stats["total"],
    })
