// ============================================================
// 江西安威 AI 客服助手 — 前端聊天组件
// 零依赖，纯 JS + CSS，直接嵌入网站
// ============================================================
(function () {
  "use strict";

  // ---- 配置 ----
  const API_URL = "https://jxanwei-chatbot.zongdq.deno.net/chat";
  const COMPANY_NAME = "安威信息 AI 客服";
  const GREETING = "您好！我是安威信息的 AI 客服助手 👋\n\n我可以帮您了解：\n• 渗透测试与安全评估\n• 安全监测与加固服务\n• 等保合规咨询\n• 免费网站安全检测\n\n请问有什么可以帮到您的？";

  // ---- 样式注入 ----
  const css = `
.ai-chat-btn {
  position:fixed;bottom:24px;right:24px;z-index:9999;
  width:56px;height:56px;border-radius:50%;background:linear-gradient(135deg,#2563eb,#1e3a5f);
  border:none;cursor:pointer;box-shadow:0 4px 20px rgba(37,99,235,.4);
  display:flex;align-items:center;justify-content:center;transition:all .3s;
}
.ai-chat-btn:hover {transform:scale(1.08);box-shadow:0 6px 28px rgba(37,99,235,.5);}
.ai-chat-btn svg {width:24px;height:24px;fill:#fff;}
.ai-chat-btn .unread-dot {
  position:absolute;top:4px;right:4px;width:10px;height:10px;border-radius:50%;
  background:#ef4444;border:2px solid #fff;display:none;
}

.ai-chat-panel {
  position:fixed;bottom:96px;right:24px;z-index:9998;
  width:380px;height:520px;max-height:calc(100vh - 140px);
  background:#fff;border-radius:16px;box-shadow:0 8px 40px rgba(0,0,0,.12);
  display:none;flex-direction:column;overflow:hidden;
  border:1px solid #e2e8f0;
}
.ai-chat-panel.open {display:flex;}
@media(max-width:440px){
  .ai-chat-panel{width:calc(100vw-32px);right:16px;bottom:88px;height:480px;}
  .ai-chat-btn{right:16px;bottom:20px;}
}

.ai-chat-header {
  background:linear-gradient(135deg,#0a1628,#1e3a5f);color:#fff;
  padding:16px 20px;display:flex;align-items:center;justify-content:space-between;
}
.ai-chat-header h3 {margin:0;font-size:1.05rem;font-weight:600;display:flex;align-items:center;gap:8px;}
.ai-chat-header h3 .dot {width:8px;height:8px;border-radius:50%;background:#22c55e;display:inline-block;}
.ai-chat-close {background:none;border:none;color:rgba(255,255,255,.7);cursor:pointer;font-size:1.3rem;padding:4px;}
.ai-chat-close:hover {color:#fff;}

.ai-chat-body {flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:12px;background:#f8fafc;}
.ai-chat-body .msg {max-width:85%;padding:10px 14px;border-radius:14px;font-size:.92rem;line-height:1.6;word-break:break-word;}
.ai-chat-body .msg.bot {align-self:flex-start;background:#fff;border:1px solid #e2e8f0;color:#334155;border-bottom-left-radius:6px;}
.ai-chat-body .msg.user {align-self:flex-end;background:#2563eb;color:#fff;border-bottom-right-radius:6px;}
.ai-chat-body .msg .time {font-size:.7rem;opacity:.6;margin-top:4px;}
.ai-chat-body .typing {align-self:flex-start;display:flex;gap:4px;padding:10px 14px;}
.ai-chat-body .typing span {width:6px;height:6px;border-radius:50%;background:#94a3b8;animation:ai-bounce 1.4s infinite ease-in-out;}
.ai-chat-body .typing span:nth-child(2){animation-delay:.15s;}
.ai-chat-body .typing span:nth-child(3){animation-delay:.3s;}
@keyframes ai-bounce{0%,60%,100%{transform:translateY(0)}30%{transform:translateY(-6px)}}

.ai-chat-footer {padding:12px 16px;border-top:1px solid #e2e8f0;display:flex;gap:8px;background:#fff;}
.ai-chat-footer input {flex:1;border:1px solid #e2e8f0;border-radius:20px;padding:10px 16px;font-size:.9rem;outline:none;transition:border-color .2s;}
.ai-chat-footer input:focus {border-color:#2563eb;}
.ai-chat-footer button {background:#2563eb;color:#fff;border:none;border-radius:50%;width:38px;height:38px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all .2s;flex-shrink:0;}
.ai-chat-footer button:hover {background:#1d4ed8;}
.ai-chat-footer button:disabled {opacity:.5;cursor:not-allowed;}
.ai-chat-footer button svg {width:16px;height:16px;fill:#fff;}
`;

  const styleEl = document.createElement("style");
  styleEl.textContent = css;
  document.head.appendChild(styleEl);

  // ---- DOM 构建 ----
  const btnHTML = `
<button class="ai-chat-btn" id="aiChatBtn" aria-label="在线客服">
  <svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>
  <span class="unread-dot" id="aiUnread"></span>
</button>`;

  const panelHTML = `
<div class="ai-chat-panel" id="aiChatPanel">
  <div class="ai-chat-header">
    <h3><span class="dot"></span>${COMPANY_NAME}</h3>
    <button class="ai-chat-close" id="aiChatClose">&times;</button>
  </div>
  <div class="ai-chat-body" id="aiChatBody"></div>
  <div class="ai-chat-footer">
    <input type="text" id="aiChatInput" placeholder="输入您的问题…" maxlength="500">
    <button id="aiChatSend" title="发送">
      <svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
    </button>
  </div>
</div>`;

  document.body.insertAdjacentHTML("beforeend", btnHTML + panelHTML);

  // ---- 状态 ----
  const btn = document.getElementById("aiChatBtn")!;
  const panel = document.getElementById("aiChatPanel")!;
  const body = document.getElementById("aiChatBody")!;
  const input = document.getElementById("aiChatInput") as HTMLInputElement;
  const sendBtn = document.getElementById("aiChatSend")!;
  const unread = document.getElementById("aiUnread")!;

  let isOpen = false;
  let isStreaming = false;
  const messages = [];

  // 从 localStorage 恢复会话
  const saved = localStorage.getItem("jxanwei_chat");
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed)) messages.push(...parsed);
    } catch { /* ignore */ }
  }

  function saveMessages() {
    // 只保留最近 30 条
    const recent = messages.slice(-30);
    localStorage.setItem("jxanwei_chat", JSON.stringify(recent));
  }

  // ---- 渲染 ----
  function addMessage(role, content) {
    const div = document.createElement("div");
    div.className = `msg ${role}`;
    div.textContent = content; div.style.whiteSpace = "pre-wrap";
    const now = new Date();
    const timeDiv = document.createElement("div"); timeDiv.className = "time";
    timeDiv.textContent = `${now.getHours().toString().padStart(2,"0")}:${now.getMinutes().toString().padStart(2,"0")}`;
    div.appendChild(timeDiv);
    body.appendChild(div);
    body.scrollTop = body.scrollHeight;
  function showTyping() {
    const div = document.createElement("div");
    div.className = "typing"; div.id = "aiTyping";
    for (let i = 0; i < 3; i++) { const s = document.createElement("span"); div.appendChild(s); }
    body.appendChild(div);
    body.scrollTop = body.scrollHeight;
  }
    body.scrollTop = body.scrollHeight;
  }

  function hideTyping() {
    document.getElementById("aiTyping")?.remove();
  }

  function renderHistory() {
    body.textContent = "";
    for (const m of messages) {
      addMessage(m.role, m.content);
    }
  }

  // ---- 发送消息 ----
  async function send() {
    const text = input.value.trim();
    if (!text || isStreaming) return;

    input.value = "";
    input.focus();

    // 添加到对话
    messages.push({ role: "user", content: text });
    addMessage("user", text);
    saveMessages();

    // 流式请求
    isStreaming = true;
    sendBtn.setAttribute("disabled", "true");
    showTyping();

    try {
      const resp = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages }),
      });

      if (!resp.ok) {
        hideTyping();
        const errMsg = "抱歉，服务暂时不可用，请直接拨打 0791-86662916 联系我们。";
        messages.push({ role: "assistant", content: errMsg });
        addMessage("assistant", errMsg);
        saveMessages();
        return;
      }

      // 读取 SSE 流
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let botMsg = "";
      let msgDiv = null;
      hideTyping();

      // 创建 Bot 消息容器
      msgDiv = document.createElement("div");
      msgDiv.className = "msg bot";
      body.appendChild(msgDiv);

      const now = new Date();
      const timeStr = `${now.getHours().toString().padStart(2,"0")}:${now.getMinutes().toString().padStart(2,"0")}`;

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
            msgDiv.textContent = botMsg; msgDiv.style.whiteSpace = "pre-wrap";
            const td1 = document.createElement("div"); td1.className = "time"; td1.textContent = timeStr; msgDiv.appendChild(td1);
              `<div class="time">${timeStr}</div>`;
            body.scrollTop = body.scrollHeight;
            messages.push({ role: "assistant", content: botMsg });
            saveMessages();
            return;
          }
          msgDiv.textContent = botMsg; msgDiv.style.whiteSpace = "pre-wrap";
          const td2 = document.createElement("div"); td2.className = "time"; td2.textContent = timeStr; msgDiv.appendChild(td2);
            `<div class="time">${timeStr}</div>`;
          body.scrollTop = body.scrollHeight;
        }
      }
    } catch (e) {
      hideTyping();
      const errMsg = "网络异常，请稍后重试或拨打 0791-86662916。";
      messages.push({ role: "assistant", content: errMsg });
      addMessage("assistant", errMsg);
      saveMessages();
    } finally {
      isStreaming = false;
      sendBtn.removeAttribute("disabled");
    }
  }

  // ---- 事件绑定 ----
  btn.addEventListener("click", () => {
    isOpen = !isOpen;
    if (isOpen) {
      panel.classList.add("open");
      unread.style.display = "none";
      if (body.children.length === 0 && messages.length === 0) {
        // 首次打开，显示问候语
        messages.push({ role: "assistant", content: GREETING });
        addMessage("assistant", GREETING);
        saveMessages();
      } else if (body.children.length === 0) {
        renderHistory();
      }
      input.focus();
    } else {
      panel.classList.remove("open");
    }
  });

  document.getElementById("aiChatClose").addEventListener("click", () => {
    isOpen = false;
    panel.classList.remove("open");
  });

  sendBtn.addEventListener("click", send);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });

  // 如果之前有对话，显示未读提示
  if (messages.length > 0 && messages[messages.length - 1].role === "assistant") {
    unread.style.display = "block";
  }
})();
