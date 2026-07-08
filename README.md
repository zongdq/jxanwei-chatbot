# 江西安威 AI 客服助手

基于 DeepSeek + Deno Deploy 的智能客服系统。

## 部署

1. 创建 Deno Deploy 项目（console.deno.com）
2. 连接此 GitHub 仓库
3. 设置环境变量（见 .env.example）
4. 启用 KV 数据库
5. 自动部署

## 环境变量

| 变量 | 必填 | 说明 |
|------|------|------|
| DEEPSEEK_API_KEY | 是 | DeepSeek API Key |
| WECOM_WEBHOOK | 否 | 企业微信机器人通知 |
| SERVERCHAN_SENDKEY | 否 | Server酱微信通知 |
| DAILY_BUDGET_YUAN | 否 | 每日预算（默认5元） |
| ADMIN_PASSWORD | 否 | 线索页密码 |

## 本地开发

```bash
deno task dev
```
