"""公共 API：配置、设备、简历上传、模型检测等（多 Tab 共用）。"""

from api.common.model_health import get_model_health
from api.common.router import router

__all__ = ["router", "get_model_health"]
