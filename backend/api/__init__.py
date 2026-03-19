"""
HTTP / WebSocket API 包。

按前端 Tab 划分子包（单一职责、依赖方向：子路由 → core / services / api.common / api.realtime）：

- realtime/   WebSocket 广播
- common/     配置、设备、简历上传等共用接口
- assist/     实时辅助
- practice/   模拟练习
- analytics/  能力分析
- resume/     简历优化
- jobs/       求职看板
"""
