from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from services.storage import review

router = APIRouter()


class UpdateSessionRequest(BaseModel):
    title: str | None = None
    company: str | None = None
    role: str | None = None


@router.get("/review/sessions")
async def list_sessions(page: int = 1, page_size: int = 20):
    """列表页"""
    return review.list_sessions(page, page_size)


@router.get("/review/sessions/{session_id}")
async def get_session(session_id: int):
    """详情页"""
    detail = review.get_session_detail(session_id)
    if not detail:
        raise HTTPException(404, "Session not found")
    return detail


@router.patch("/review/sessions/{session_id}")
async def update_session(session_id: int, req: UpdateSessionRequest):
    """更新会话信息（标题、公司、岗位）"""
    try:
        review.update_session_info(
            session_id=session_id,
            title=req.title,
            company=req.company,
            role=req.role,
        )
        return {"success": True}
    except Exception as e:
        raise HTTPException(500, str(e))


@router.get("/review/current")
async def get_current_session():
    """当前进行中的 session"""
    current = review.get_current_session()
    return {"session": current}


@router.get("/review/profile")
async def get_profile():
    """长期画像（首版返回空）"""
    return {
        "session_count": 0,
        "summary": None,
        "strengths": [],
        "weaknesses": [],
        "behavior_traits": [],
        "domain_mastery": {},
        "trend": [],
    }
