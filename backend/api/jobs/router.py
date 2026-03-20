from typing import Any, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from services.storage import job_tracker as jt

router = APIRouter()


class ApplicationCreate(BaseModel):
    company: str = ""
    position: str = ""
    city: str = ""
    stage: str = "applied"
    applied_at: Optional[float] = None
    next_followup_at: Optional[float] = None
    interviewer_info: str = ""
    feedback: str = ""
    todos: Optional[list[dict[str, Any]]] = None
    notes: str = ""
    sort_order: int = 0


class ApplicationPatch(BaseModel):
    company: Optional[str] = None
    position: Optional[str] = None
    city: Optional[str] = None
    stage: Optional[str] = None
    applied_at: Optional[float] = None
    next_followup_at: Optional[float] = None
    interviewer_info: Optional[str] = None
    feedback: Optional[str] = None
    todos: Optional[list[dict[str, Any]]] = None
    notes: Optional[str] = None
    sort_order: Optional[int] = None


class BatchStageBody(BaseModel):
    ids: list[int]
    stage: str


class ReorderStageBody(BaseModel):
    """将某阶段下记录的 sort_order 按 ordered_ids 顺序重排（须与该阶段当前 id 集合一致）。"""

    stage: str
    ordered_ids: list[int]


class OfferCreate(BaseModel):
    application_id: int
    base_salary: str = ""
    total_pkg_note: str = ""
    bonus: str = ""
    equity: str = ""
    benefits: Optional[list[str]] = None
    wfh: str = ""
    location: str = ""
    pros: str = ""
    cons: str = ""
    deadline: Optional[float] = None


class OfferPatch(BaseModel):
    base_salary: Optional[str] = None
    total_pkg_note: Optional[str] = None
    bonus: Optional[str] = None
    equity: Optional[str] = None
    benefits: Optional[list[str]] = None
    wfh: Optional[str] = None
    location: Optional[str] = None
    pros: Optional[str] = None
    cons: Optional[str] = None
    deadline: Optional[float] = None


class CompareBody(BaseModel):
    offer_ids: list[int] = Field(default_factory=list)


@router.get("/job-tracker/stages")
async def api_stages():
    return {"stages": jt.list_stages()}


@router.get("/job-tracker/applications")
async def api_list_applications(
    stage: Optional[str] = None,
    q: Optional[str] = None,
    sort_by: str = "updated_at",
    sort_dir: str = "desc",
):
    return {"items": jt.list_applications(stage=stage, q=q, sort_by=sort_by, sort_dir=sort_dir)}


@router.post("/job-tracker/applications")
async def api_create_application(body: ApplicationCreate):
    data = body.model_dump(exclude_none=True)
    return jt.create_application(data)


@router.patch("/job-tracker/applications/batch-stage")
async def api_batch_stage(body: BatchStageBody):
    n = jt.batch_update_stage(body.ids, body.stage)
    return {"updated": n}


@router.patch("/job-tracker/applications/reorder-stage")
async def api_reorder_stage(body: ReorderStageBody):
    n = jt.reorder_stage_applications(body.stage, body.ordered_ids)
    if n <= 0:
        raise HTTPException(400, "Invalid stage or ordered_ids does not match current applications in that stage")
    return {"updated": n}


@router.patch("/job-tracker/applications/{app_id}")
async def api_patch_application(app_id: int, body: ApplicationPatch):
    # 保留显式 null，便于清空日期等字段
    patch = body.model_dump(exclude_unset=True)
    if not patch:
        row = jt.get_application(app_id)
        if not row:
            raise HTTPException(404, "Not found")
        return row
    row = jt.patch_application(app_id, patch)
    if not row:
        raise HTTPException(404, "Not found")
    return row


@router.delete("/job-tracker/applications/{app_id}")
async def api_delete_application(app_id: int):
    if not jt.delete_application(app_id):
        raise HTTPException(404, "Not found")
    return {"ok": True}


@router.get("/job-tracker/offers")
async def api_list_offers():
    return {"items": jt.list_offers()}


@router.post("/job-tracker/offers")
async def api_create_offer(body: OfferCreate):
    data = body.model_dump(exclude_none=True)
    return jt.create_or_update_offer(data)


@router.patch("/job-tracker/offers/{offer_id}")
async def api_patch_offer(offer_id: int, body: OfferPatch):
    patch = body.model_dump(exclude_unset=True)
    if not patch:
        row = jt.get_offer(offer_id)
        if not row:
            raise HTTPException(404, "Not found")
        return row
    row = jt.patch_offer(offer_id, patch)
    if not row:
        raise HTTPException(404, "Not found")
    return row


@router.delete("/job-tracker/offers/{offer_id}")
async def api_delete_offer(offer_id: int):
    if not jt.delete_offer(offer_id):
        raise HTTPException(404, "Not found")
    return {"ok": True}


@router.post("/job-tracker/compare")
async def api_compare(body: CompareBody):
    return {"items": jt.compare_offers(body.offer_ids)}
