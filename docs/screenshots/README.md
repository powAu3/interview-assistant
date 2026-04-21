# README 素材维护

本目录存放 README 使用的截图、封面图和演示视频。

当前推荐用自动脚本生成，而不是手动逐张截图。脚本会启动前端预览页，在浏览器里注入样例数据并输出统一尺寸的 PNG / GIF / WebM，因此不依赖后端服务、数据库或真实 API Key。

## 自动生成

```bash
cd frontend
npx playwright install chromium   # 首次执行需要
npm run screenshots:readme
npm run demo:readme
```

## 生成结果

| 文件名 | 对应内容 |
| --- | --- |
| `assist-demo.webm` | README 顶部 `58 秒` 主流程演示视频 |
| `assist-demo-poster.png` | 视频封面图 |
| `assist-demo.gif` | 兼容旧展示方式保留的 GIF 版本 |
| `assist-mode.png` | 实时辅助 |
| `practice-mode.png` | 模拟练习 |
| `knowledge-map.png` | 能力分析 |
| `resume-optimizer.png` | 简历优化 |

默认输出目录就是当前 `docs/screenshots/`，README 会直接引用这些文件。

## 视频内容约定

README 顶部视频建议控制在 `30s-60s`，优先展示这些内容：

1. 进入实时辅助主流程
2. 实时转写与自动回答
3. 手动补一句追问
4. 收起转录面板聚焦答案
5. 简单带一下知识库引用或知识库抽屉

## 手动更新

如果你想截取真实运行中的界面，也可以手动更新：

1. 启动应用：
   - `python start.py --mode network`
   - 或 `python start.py`
2. 打开浏览器：

   ```bash
   python scripts/open-for-screenshots.py
   ```

3. 覆盖对应素材文件。

建议保持统一的桌面尺寸和缩放比例，避免 README 中的媒体风格不一致。
