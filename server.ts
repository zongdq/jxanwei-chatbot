// ============================================================
// 江西安威 AI 客服助手 — Deno 后端 v2
// 部署: cd chatbot && deployctl deploy --project=jxanwei-chatbot --prod server.ts
// ============================================================
import { Hono } from "https://deno.land/x/hono@v4.3.11/mod.ts";
import { cors } from "https://deno.land/x/hono@v4.3.11/middleware/cors/index.ts";
import { streamSSE } from "https://deno.land/x/hono@v4.3.11/helper/streaming/index.ts";

const app = new Hono();

// ---- 环境变量配置 ----
const DEEPSEEK_API_KEY = Deno.env.get("DEEPSEEK_API_KEY") || "";
const DEEPSEEK_BASE = "https://api.deepseek.com/v1";

// 通知渠道（配哪个用哪个，可同时配多个）
const WECOM_WEBHOOK = Deno.env.get("WECOM_WEBHOOK") || "";       // 企业微信机器人
const SERVERCHAN_KEY = Deno.env.get("SERVERCHAN_SENDKEY") || ""; // Server酱 微信推送

// 预算控制
const DAILY_BUDGET_YUAN = parseFloat(Deno.env.get("DAILY_BUDGET_YUAN") || "5"); // 每日预算（元）
const MAX_HISTORY = parseInt(Deno.env.get("MAX_HISTORY_ROUNDS") || "10");        // 最多保留对话轮数

const ALLOWED_ORIGIN = Deno.env.get("ALLOWED_ORIGIN") || "*";
const ADMIN_PASSWORD = Deno.env.get("ADMIN_PASSWORD") || ""; // 线索页面密码（空=无密码）

const kv = await Deno.openKv();

// DeepSeek 定价（元/百万tokens）
const PRICE_INPUT = 1;   // ¥1/1M
const PRICE_OUTPUT = 2;  // ¥2/1M

// ---- 精简 System Prompt（~500 字，节省 token） ----
const SYSTEM_PROMPT = `你是「江西安威信息安全技术有限公司」（安威信息）的客服。公司2017年成立，位于南昌市高新区高新大道555号特康大厦15楼，国家高新技术企业。

服务范围：
1. 渗透测试 — Web/内网/移动端/无线网络，人工验证报告
2. 监测加固 — 资产发现、漏洞扫描、弱口令检测(20+协议)、网站监测(9维度)、配置核查、安全加固
3. 预警处置 — 蜜罐威胁监测、入侵检测、7×24应急响应
4. 专项服务 — 重保值守、应急演练、安全培训、WAF防护、迎检、漏洞无效化、安全巡检、高危预警、网络运维
5. 咨询规划 — 等保测评全流程、网络安全法合规
6. 免费网站安全检测 — 漏洞扫描+7×24监测，免费试用

联系方式：电话 0791-86662916 | 邮箱 Info@awsafe.cn | 周一至周五 09:00-18:00

【核心策略 — 非常重要】
在对话中自然地：
1. 先了解客户行业和需求方向
2. 兴趣明确时引导留联系方式，如："方便留个电话吗？我让技术顾问给您出个详细方案。"、"您留个邮箱，我发份资料给您参考。"
3. 客户留下联系方式后感谢，告知会尽快联系
4. 客户问价格 → 表示需评估具体需求后报价，顺势要联系方式
5. 保持专业亲和，不要暴露你是AI`;

// ---- Token 预算跟踪 ----
async function trackTokens(inputTokens: number, outputTokens: number) {
  const today = new Date().toISOString().slice(0, 10); // "2026-07-07"
  const key = ["budget", today];
  const current = await kv.get<{ tokens: number; cost: number }>(key);
  const prev = current.value || { tokens: 0, cost: 0 };

  const inputCost = (inputTokens / 1_000_000) * PRICE_INPUT;
  const outputCost = (outputTokens / 1_000_000) * PRICE_OUTPUT;
  const totalCost = inputCost + outputCost;

  const updated = {
    tokens: prev.tokens + inputTokens + outputTokens,
    cost: prev.cost + totalCost,
  };

  await kv.set(key, updated);
  return updated;
}

async function checkBudget(): Promise<{ allowed: boolean; today: { tokens: number; cost: number } }> {
  const today = new Date().toISOString().slice(0, 10);
  const current = await kv.get<{ tokens: number; cost: number }>(["budget", today]);
  const today_ = current.value || { tokens: 0, cost: 0 };
  return {
    allowed: today_.cost < DAILY_BUDGET_YUAN,
    today: today_,
  };
}

// ---- 联系方式识别 ----
function extractContact(text: string): { phone?: string; email?: string; wechat?: string } {
  const result: { phone?: string; email?: string; wechat?: string } = {};

  const phoneMatch = text.match(/(?:\+?86)?[-\s]?1[3-9]\d{9}|(?:\d{3,4}[-\s]?){2}\d{4,8}/);
  if (phoneMatch) result.phone = phoneMatch[0].trim();

  const emailMatch = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  if (emailMatch) result.email = emailMatch[0];

  const wechatMatch = text.match(/(?:微信|v信|VX|vx|wx|WX)[:：\s]*([a-zA-Z0-9_-]{6,20})/i);
  if (wechatMatch) result.wechat = wechatMatch[1];

  return result;
}

// ---- 企业微信通知 ----
async function notifyWecom(contact: string, needs: string) {
  if (!WECOM_WEBHOOK) return false;
  try {
    const now = new Date().toLocaleString("zh-CN");
    await fetch(WECOM_WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        msgtype: "markdown",
        markdown: {
          content: `## 🆕 新客户咨询\n> 时间：<font color="comment">${now}</font>\n> 联系方式：<font color="info">${contact}</font>\n> 咨询摘要：${needs.slice(0, 200)}`,
        },
      }),
    });
    return true;
  } catch (e) {
    console.error("企业微信通知失败:", e);
    return false;
  }
}

// ---- Server酱 微信通知 ----
async function notifyServerChan(contact: string, needs: string) {
  if (!SERVERCHAN_KEY) return false;
  try {
    const now = new Date().toLocaleString("zh-CN");
    await fetch(`https://sctapi.ftqq.com/${SERVERCHAN_KEY}.send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: `新客户咨询 — ${contact}`,
        desp: `## 新客户线索\n\n**时间：** ${now}\n\n**联系方式：** ${contact}\n\n**咨询摘要：**\n${needs}`,
      }),
    });
    return true;
  } catch (e) {
    console.error("Server酱通知失败:", e);
    return false;
  }
}

// ---- 统一通知（尝试所有已配置渠道） ----
async function notifyAll(contact: string, needs: string) {
  const results = await Promise.all([
    notifyWecom(contact, needs),
    notifyServerChan(contact, needs),
  ]);
  return results.some(Boolean);
}

// ---- 保存线索 ----
async function saveLead(data: { contact: Record<string, string>; messages: string[]; timestamp: string }) {
  const id = crypto.randomUUID();
  await kv.set(["leads", id], data);
  return id;
}

// ---- 速率限制 ----
const rateLimitMap = new Map<string, { count: number; reset: number }>();
const RATE_LIMIT = 20;
const RATE_WINDOW = 60_000;

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.reset) {
    rateLimitMap.set(ip, { count: 1, reset: now + RATE_WINDOW });
    return true;
  }
  if (entry.count >= RATE_LIMIT) return false;
  entry.count++;
  return true;
}

// ---- CORS ----
app.use("*", cors({ origin: ALLOWED_ORIGIN }));

// ---- 状态页（含今日用量） ----
app.get("/health", async (c) => {
  const { today } = await checkBudget();
  return c.json({
    status: "ok",
    budget: {
      daily: DAILY_BUDGET_YUAN,
      used: Math.round(today.cost * 10000) / 10000,
      tokens: today.tokens,
      remaining: Math.round((DAILY_BUDGET_YUAN - today.cost) * 10000) / 10000,
    },
    notifications: {
      wecom: !!WECOM_WEBHOOK,
      serverchan: !!SERVERCHAN_KEY,
    },
  });
});

// ---- 线索管理页 ----
app.get("/admin/leads", async (c) => {
  // 简单密码保护
  if (ADMIN_PASSWORD) {
    const auth = c.req.header("Authorization") || "";
    const expected = "Basic " + btoa("admin:" + ADMIN_PASSWORD);
    if (auth !== expected) {
      c.header("WWW-Authenticate", 'Basic realm="Leads"');
      return c.text("Unauthorized", 401);
    }
  }

  const leads: unknown[] = [];
  const iter = kv.list({ prefix: ["leads"] });
  for await (const entry of iter) {
    leads.push({ id: entry.key[1] as string, ...entry.value as object });
  }
  leads.reverse();

  return c.html(`<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>客户线索 — 安威信息</title>
<style>
body{font-family:"PingFang SC","Microsoft YaHei",sans-serif;background:#f8fafc;padding:20px;max-width:900px;margin:0 auto}
h1{color:#0f172a;border-bottom:2px solid #2563eb;padding-bottom:12px}
.stats{display:flex;gap:16px;margin-bottom:20px}
.stat{background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:14px 20px;flex:1;text-align:center}
.stat .num{font-size:1.8rem;font-weight:800;color:#2563eb}
.stat .label{font-size:.8rem;color:#94a3b8;margin-top:4px}
.lead{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:20px;margin-bottom:16px}
.lead .time{color:#94a3b8;font-size:.85rem}
.lead .contact{color:#2563eb;font-weight:700;font-size:1.1rem;margin:8px 0}
.lead .needs{color:#475569;line-height:1.7;font-size:.9rem}
.lead .needs p{margin:4px 0}
.empty{text-align:center;padding:60px;color:#94a3b8}
.refresh{float:right;background:#2563eb;color:#fff;border:none;border-radius:8px;padding:8px 16px;cursor:pointer;font-size:.85rem}
</style>
</head>
<body>
<h1>📋 客户线索 <button class="refresh" onclick="location.reload()">刷新</button></h1>
<div class="stats">
  <div class="stat"><div class="num">${leads.length}</div><div class="label">总线索数</div></div>
  <div class="stat"><div class="num">${leads.filter((l: any) => l.contact?.phone).length}</div><div class="label">有电话</div></div>
  <div class="stat"><div class="num">${leads.filter((l: any) => l.contact?.email).length}</div><div class="label">有邮箱</div></div>
</div>
${leads.length === 0 ? '<div class="empty">暂无客户线索</div>' : ""}
${leads.map((l: any) => {
  const contactStr = [l.contact?.phone, l.contact?.email, l.contact?.wechat].filter(Boolean).join(" / ") || "未获取到联系方式";
  return `<div class="lead">
    <div class="time">${l.timestamp || ""}</div>
    <div class="contact">📞 ${contactStr}</div>
    <div class="needs">${l.messages?.map((m: string) => `<p>${m}</p>`).join("") || ""}</div>
  </div>`;
}).join("")}
</body></html>`);
});

// ---- 聊天 API ----
app.post("/chat", async (c) => {
  const ip = c.req.header("x-forwarded-for") || c.req.header("x-real-ip") || "unknown";

  if (!checkRateLimit(ip)) {
    return c.json({ error: "请求过于频繁，请稍后再试" }, 429);
  }

  // 检查预算
  const budget = await checkBudget();
  if (!budget.allowed) {
    return c.json({ error: "今日咨询已满，请明天再来或直接拨打 0791-86662916 联系我们。" }, 429);
  }

  const body = await c.req.json();
  const messages = (body as any).messages;
  if (!messages || !Array.isArray(messages)) {
    return c.json({ error: "无效的请求" }, 400);
  }

  // 检测联系方式
  const lastUserMsg = [...messages].reverse().find(m => m.role === "user");
  const userText = lastUserMsg?.content || "";
  const contact = extractContact(userText);

  if (contact.phone || contact.email || contact.wechat) {
    const contactStr = [contact.phone, contact.email, contact.wechat].filter(Boolean).join(" / ");
    const recentMessages = messages.slice(-6).map(m => `${m.role === "user" ? "👤" : "🤖"}: ${m.content}`);
    await saveLead({
      contact,
      messages: recentMessages,
      timestamp: new Date().toISOString(),
    });
    await notifyAll(contactStr, recentMessages.join("\n"));
  }

  // 裁剪历史：只保留最近 N 轮（每轮 = 1 user + 1 assistant）
  const recentMessages = messages.slice(-MAX_HISTORY * 2);

  try {
    const resp = await fetch(`${DEEPSEEK_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          ...recentMessages,
        ],
        stream: true,
        max_tokens: 1024,
        temperature: 0.7,
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error("DeepSeek API 错误:", resp.status, errText);
      return c.json({ error: "AI 服务暂时不可用" }, 502);
    }

    // 流式返回
    return streamSSE(c, async (stream) => {
      const reader = resp.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let totalOutput = "";

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data: ")) continue;
            const data = trimmed.slice(6);
            if (data === "[DONE]") {
              // 估算 token 用量并记录
              const estInput = SYSTEM_PROMPT.length + recentMessages.reduce((s, m) => s + m.content.length, 0);
              const estOutput = totalOutput.length;
              // 粗略估算：中文约 1.5 字符/token
              trackTokens(Math.ceil(estInput / 1.5), Math.ceil(estOutput / 1.5));
              await stream.writeSSE({ data: "[DONE]" });
              return;
            }
            try {
              const parsed = JSON.parse(data);
              const delta = parsed.choices?.[0]?.delta?.content;
              if (delta) {
                totalOutput += delta;
                await stream.writeSSE({ data: delta });
              }
            } catch { /* skip */ }
          }
        }
      } finally {
        reader.releaseLock();
      }
    });
  } catch (e) {
    console.error("DeepSeek 异常:", e);
    return c.json({ error: "服务异常，请稍后重试" }, 500);
  }
});

// ---- 免费试用提交 ----
app.post("/trial", async (c) => {
  const body = await c.req.json();
  const data = body as any;
  const name = (data.name || "").trim();
  const phone = (data.phone || "").trim();
  const code = (data.code || "").trim();

  if (!name || name.length < 2) return c.json({ error: "请填写公司名称或个人姓名" }, 400);
  if (!/^1[3-9]\d{9}$/.test(phone)) return c.json({ error: "请填写正确的手机号码" }, 400);
  if (code.length < 4) return c.json({ error: "请输入验证码" }, 400);

  const contact = { phone };
  const now = new Date().toLocaleString("zh-CN");
  const summary = `试用申请人：${name}\n手机号：${phone}\n提交时间：${now}`;

  await saveLead({ contact, messages: [summary], timestamp: new Date().toISOString() });
  await notifyAll(`试用-${name} / ${phone}`, summary);

  return c.json({ ok: true, message: "提交成功，我们将尽快与您联系" });
});

Deno.serve({ port: 8000 }, app.fetch);
