# 界面截图说明

用于 README 的界面预览图，请按下列文件名保存到本目录。

## 如何更新截图

1. **启动应用**（任选其一）：
   - 网络模式：`python start.py --mode network`
   - 桌面模式：`python start.py`，再在浏览器访问 `http://localhost:18080`（若端口一致）

2. **打开浏览器**：
   ```bash
   python scripts/open-for-screenshots.py
   ```
   会打开 `http://localhost:18080`（请先确保服务已启动）。

3. **截取四个界面**，保存为 PNG，文件名如下：

| 文件名 | 对应界面 |
|--------|----------|
| `assist-mode.png` | 顶部切到「实时辅助」后的主界面（转录 + 问答 + 控制栏） |
| `practice-mode.png` | 顶部切到「模拟练习」后的界面 |
| `knowledge-map.png` | 顶部切到「能力分析」后的雷达图等 |
| `resume-optimizer.png` | 顶部切到「简历优化」后的界面 |

4. 将上述四个文件放入 `docs/screenshots/` 目录，README 中的界面预览会自动展示。

建议截图分辨率适中（如 1200–1400 宽），便于在文档中清晰展示。
