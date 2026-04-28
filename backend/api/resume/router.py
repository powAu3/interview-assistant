import threading
import uuid
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from core.resource_lanes import submit_low_priority_background
from services.resume_optimizer import optimize_resume_stream
from services.llm import get_token_stats
from api.realtime.ws import broadcast


router = APIRouter()
_resume_opt_lock = threading.Lock()
_resume_opt_current_job_id: str | None = None


class OptimizeRequest(BaseModel):
    jd: str


@router.post("/resume/optimize")
async def api_resume_optimize(body: OptimizeRequest):
    global _resume_opt_current_job_id
    job_id = uuid.uuid4().hex
    with _resume_opt_lock:
        previous_job_id = _resume_opt_current_job_id
        _resume_opt_current_job_id = job_id
        accepted = submit_low_priority_background(_run_optimize, body.jd, job_id)
        if not accepted:
            _resume_opt_current_job_id = previous_job_id
            raise HTTPException(429, "后台低优先级队列繁忙，请稍后重试")
    return {"ok": True, "job_id": job_id}


def _is_current_resume_opt_job(job_id: str) -> bool:
    with _resume_opt_lock:
        return _resume_opt_current_job_id == job_id


def _resume_opt_payload(event_type: str, job_id: str, **extra):
    return {"type": event_type, "scope": "resume-opt", "job_id": job_id, **extra}


def _run_optimize(jd: str, job_id: str):
    if not _is_current_resume_opt_job(job_id):
        return
    broadcast(_resume_opt_payload("resume_opt_start", job_id))
    full_text = ""
    try:
        for chunk in optimize_resume_stream(jd):
            if not _is_current_resume_opt_job(job_id):
                return
            full_text += chunk
            broadcast(_resume_opt_payload("resume_opt_chunk", job_id, chunk=chunk))
    except Exception as e:
        if not _is_current_resume_opt_job(job_id):
            return
        full_text += f"\n\n[错误: {e}]"
        broadcast(_resume_opt_payload("resume_opt_chunk", job_id, chunk=f"\n\n[错误: {e}]"))
    try:
        if not _is_current_resume_opt_job(job_id):
            return
        broadcast(_resume_opt_payload("resume_opt_done", job_id, text=full_text))
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
