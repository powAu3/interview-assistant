from fastapi import APIRouter
from services.storage.knowledge import get_summary, get_history, reset_all

router = APIRouter()


@router.get("/knowledge/summary")
async def api_knowledge_summary():
    return {"tags": get_summary()}


@router.get("/knowledge/history")
async def api_knowledge_history(page: int = 1, page_size: int = 20):
    return get_history(page, page_size)


@router.delete("/knowledge/reset")
async def api_knowledge_reset():
    reset_all()
    return {"ok": True}
