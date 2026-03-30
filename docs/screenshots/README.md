# README 截图维护

本目录存放 README 使用的界面截图和演示动图。

当前推荐用自动脚本生成，而不是手动逐张截图。脚本会启动前端预览页，在浏览器里注入样例数据并输出统一尺寸的 PNG / GIF，因此不依赖后端服务、数据库或真实 API Key。

## 自动生成

```bash
cd frontend
npx playwright install chromium   # 首次执行需要
npm run screenshots:readme
npm run demo:readme
```

生成结果会覆盖以下文件：

| 文件名 | 对应界面 |
| --- | --- |
| `assist-demo.gif` | README 顶部演示动图 |
| `assist-demo-poster.png` | 演示动图的静态封面 |
| `assist-mode.png` | 实时辅助 |
| `practice-mode.png` | 模拟练习 |
| `knowledge-map.png` | 能力分析 |
| `resume-optimizer.png` | 简历优化 |

默认输出目录就是当前 `docs/screenshots/`，README 会直接引用这些文件。

## 手动更新

如果你想截取真实运行中的界面，也可以手动更新：

1. 启动应用：
   - `python start.py --mode network`
   - 或 `python start.py`
2. 打开浏览器：

   ```bash
   python scripts/open-for-screenshots.py
   ```

3. 分别截取上表对应页面，保存为同名 PNG，覆盖本目录文件。

建议保持统一的桌面尺寸和缩放比例，避免 README 中四张图风格不一致。
