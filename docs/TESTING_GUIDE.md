# Browser-Use-Plugin 操作测试指南

本指南帮助你完成扩展的安装、配置和测试验证。

---

## 📋 系统要求

- **macOS** (当前配置针对 macOS)
- **Chrome** 或 **Microsoft Edge** 浏览器
- **Node.js** (推荐 18+)
- **Python 3.11+** 和 **uv** 包管理器

---

## 🚀 快速开始

### 步骤 1：构建 Chrome 扩展

```bash
cd /Users/cory/codes/browser-use-plugin

# 安装依赖
npm install

# 构建扩展
npm run build
```

构建完成后，`dist/` 目录将包含：
- `content.js` - 内容脚本
- `background.js` - 后台脚本

---

### 步骤 2：安装 Python 依赖

```bash
cd native_host

# 使用 uv 安装依赖
uv sync
```

> **注意**: `run_host.sh` 中配置的 uv 路径为 `/Users/cory/anaconda3/bin/uv`，请确保路径正确或根据实际情况修改。

---

### 步骤 3：安装 Native Messaging Host

```bash
cd native_host

# 运行安装脚本
./install_host.sh
```

此脚本会：
1. 复制 manifest 文件到 Chrome/Edge 的 NativeMessagingHosts 目录
2. 设置正确的脚本路径

---

### 步骤 4：加载 Chrome 扩展

1. 打开 Chrome，访问 `chrome://extensions/`
2. 开启右上角的 **开发者模式**
3. 点击 **加载已解压的扩展程序**
4. 选择项目根目录 `/Users/cory/codes/browser-use-plugin`

> **重要**: 加载扩展后，记下扩展的 ID（形如 `ljajelogmlifllgeaikflpmkfonlgaba`），确保与 `com.browser_use.mcp_host.json` 中的 `allowed_origins` 匹配。

---

## 🧪 测试验证

### 测试 1：验证扩展加载

1. 访问任意网页（如 `https://www.google.com`）
2. 右键点击扩展图标，选择 **检查视图 → Service Worker**
3. 在 Console 中应看到：
   ```
   Connected to native host: com.browser_use.mcp_host
   ```

---

### 测试 2：测试 Sidebar 面板

1. 在任意网页上点击扩展图标
2. 页面右侧应出现 **AXTree Inspector** 侧边栏
3. 点击 **Refresh** 按钮刷新元素列表
4. 尝试点击元素的 **Highlight** 按钮，页面上对应元素会被红框高亮

---

### 测试 3：验证 HTTP 服务器

打开终端，运行以下命令：

```bash
# 检查服务器状态
curl http://127.0.0.1:8765/health

# 期望返回：
# {"status": "ok", "native_connected": true}
```

```bash
# 列出可用工具
curl http://127.0.0.1:8765/tools
```

---

### 测试 4：获取 AXTree

确保 Chrome 中有活动标签页，然后：

```bash
curl -X POST http://127.0.0.1:8765/tools/get_ax_tree
```

**期望返回**：包含页面可交互元素的 JSON 树结构：

```json
{
  "id": "1",
  "result": {
    "success": true,
    "data": {
      "role": "tree",
      "children": [
        {
          "refId": 1,
          "role": "searchbox",
          "name": "搜索",
          "tagName": "input",
          "attributes": { "type": "text" }
        },
        {
          "refId": 2,
          "role": "button",
          "name": "Google 搜索",
          "tagName": "input"
        }
      ]
    },
    "url": "https://www.google.com/",
    "title": "Google"
  }
}
```

---

### 测试 5：执行操作

#### 点击元素

```bash
curl -X POST http://127.0.0.1:8765/tools/execute_action \
  -H "Content-Type: application/json" \
  -d '{"action_type": "click", "ref_id": 2}'
```

#### 输入文本

```bash
curl -X POST http://127.0.0.1:8765/tools/execute_action \
  -H "Content-Type: application/json" \
  -d '{"action_type": "type", "ref_id": 1, "text": "Hello World"}'
```

#### 支持的 action_type

| action_type | 描述 | 参数 |
|-------------|------|------|
| `click` | 点击元素 | `ref_id` |
| `type` | 输入文本 | `ref_id`, `text` |
| `focus` | 聚焦元素 | `ref_id` |
| `scroll` | 滚动到元素 | `ref_id` |
| `hover` | 悬停在元素上 | `ref_id` |
| `clear` | 清空输入框 | `ref_id` |

---

### 测试 6：测试 MCP stdio 接口

此接口供 Claude Code 等 MCP 客户端调用：

```bash
cd native_host

# 手动启动 stdio 服务
uv run python mcp_stdio.py
```

> **注意**: MCP stdio 模式需要先启动 HTTP 服务器（Native Messaging 会自动启动）。

---

## 🔧 调试技巧

### 查看日志

```bash
# Native Host 启动日志
tail -f /tmp/browser_use_host_debug.log

# MCP 服务器日志
tail -f /tmp/browser_use_mcp.log
```

### 手动测试 Native Messaging

如果遇到连接问题，可以手动启动 HTTP 服务器进行测试：

```bash
cd native_host
uv run python mcp_server.py --http-only --port 8765
```

然后用 curl 测试 HTTP 接口。

### 控制台调试

在网页控制台中可直接调用：

```javascript
// 获取 AXTree
window.getAXTree()

// 通过 refId 获取 DOM 元素
window.getElement(1)

// 执行操作
window.executeAction('click', 2)
window.executeAction('type', 1, '测试文本')
```

---

## ⚠️ 常见问题

### 问题 1：Native Host 连接失败

**症状**: Service Worker 控制台显示 `Native host error: ...`

**解决方案**:
1. 确认 `run_host.sh` 中的 `UV_BIN` 路径正确
2. 确认扩展 ID 与 manifest 中 `allowed_origins` 匹配
3. 重新运行 `./install_host.sh`
4. 检查 `/tmp/browser_use_host_debug.log` 日志

### 问题 2：HTTP 服务器端口被占用

```bash
# 查找占用 8765 端口的进程
lsof -i :8765

# 终止进程
kill -9 <PID>
```

### 问题 3：扩展 ID 不匹配

每次重新加载扩展可能会生成新的 ID。更新 `com.browser_use.mcp_host.json`：

```json
{
  "allowed_origins": [
    "chrome-extension://YOUR_NEW_EXTENSION_ID/"
  ]
}
```

然后重新运行 `./install_host.sh`。

---

## 📊 架构速览

```
┌─────────────┐     HTTP     ┌─────────────────┐   Native Msg   ┌──────────────┐
│ MCP Client  │◄────────────►│  mcp_server.py  │◄──────────────►│  background  │
│ (curl/LLM)  │   :8765      │                 │                │     .ts      │
└─────────────┘              └─────────────────┘                └──────┬───────┘
                                                                       │
                                                                chrome.tabs
                                                                .sendMessage
                                                                       │
                                                                       ▼
                                                                ┌──────────────┐
                                                                │  content.ts  │
                                                                │  (AXTree +   │
                                                                │   Actions)   │
                                                                └──────────────┘
```

---

## ✅ 测试检查清单

- [ ] `npm run build` 成功
- [ ] 扩展加载成功（无红色错误）
- [ ] Service Worker 显示 "Connected to native host"
- [ ] `curl /health` 返回 `native_connected: true`
- [ ] `curl /tools/get_ax_tree` 返回有效 AXTree
- [ ] 点击/输入操作正常执行
- [ ] Sidebar 可正常显示和高亮元素
