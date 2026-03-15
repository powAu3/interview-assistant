# API 密钥与模型配置

本助手使用 **OpenAI 兼容** 的 Chat Completions API，任一兼容该格式的服务均可接入。

## 配置多个模型

在 `backend/config.json` 的 `models` 数组中添加多个模型，界面顶部会出现下拉选择器，可实时切换。`active_model` 为默认选中的下标（从 0 开始）。

```json
{
  "models": [
    { "name": "GPT-4o", "api_base_url": "...", "api_key": "...", "model": "gpt-4o", "supports_think": false, "supports_vision": true },
    { "name": "DeepSeek", "api_base_url": "...", "api_key": "...", "model": "deepseek-chat", "supports_think": true, "supports_vision": false }
  ],
  "active_model": 0
}
```

- `supports_vision: true`：支持截图识题，选择器中会显示 👁
- `supports_think: true`：可启用 Think 深度思考模式

---

## 各厂商配置示例

### OpenAI (GPT-4o / GPT-4o-mini)

- **API Key**：[https://platform.openai.com/api-keys](https://platform.openai.com/api-keys)

```json
{
  "name": "GPT-4o",
  "api_base_url": "https://api.openai.com/v1",
  "api_key": "sk-proj-xxxxxxxxxxxx",
  "model": "gpt-4o",
  "supports_think": false,
  "supports_vision": true
}
```

### DeepSeek (V3 / R1)

- **API Key**：[https://platform.deepseek.com/api_keys](https://platform.deepseek.com/api_keys)

```json
{
  "name": "DeepSeek-V3",
  "api_base_url": "https://api.deepseek.com",
  "api_key": "sk-xxxxxxxxxxxx",
  "model": "deepseek-chat",
  "supports_think": true,
  "supports_vision": false
}
```

### 通义千问 (Qwen)

- **API Key**：[https://dashscope.console.aliyun.com/apiKey](https://dashscope.console.aliyun.com/apiKey)

```json
{
  "name": "Qwen-Plus",
  "api_base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
  "api_key": "sk-xxxxxxxxxxxx",
  "model": "qwen-plus",
  "supports_think": false,
  "supports_vision": true
}
```

### 智谱 GLM

- **API Key**：[智谱 AI 开放平台](https://www.bigmodel.cn/)（免费注册即送 token）

```json
{
  "name": "GLM-4.7-Flash",
  "api_base_url": "https://open.bigmodel.cn/api/paas/v4",
  "api_key": "your-zhipu-api-key",
  "model": "GLM-4.7-Flash",
  "supports_think": false,
  "supports_vision": false
}
```

多模态可用 `GLM-4.6V-Flash`，设置 `"supports_vision": true`。

### 本地部署 (Ollama)

无需 API Key，先在本机运行：`ollama serve`

```json
{
  "name": "Ollama-Qwen",
  "api_base_url": "http://localhost:11434/v1",
  "api_key": "ollama",
  "model": "qwen2.5:14b",
  "supports_think": false,
  "supports_vision": false
}
```

### Claude（通过第三方兼容 API）

需使用兼容 OpenAI 格式的 Claude 代理服务，按服务商要求填写 `api_base_url` 和 `api_key`。

```json
{
  "name": "Claude-3.5-Sonnet",
  "api_base_url": "https://your-claude-proxy.com/v1",
  "api_key": "sk-xxxxxxxxxxxx",
  "model": "claude-3-5-sonnet-20241022",
  "supports_think": false,
  "supports_vision": true
}
```
