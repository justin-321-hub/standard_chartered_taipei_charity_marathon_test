/**
 * app.js — 前端純 JS 聊天室邏輯（無框架）
 * ---------------------------------------------------------
 * 
 * 修改日期：2025-12-01
 * 修改內容：
 *   - 將機器人回覆從純文字改為 HTML 渲染
 *   - 使用 innerHTML 取代 innerText 以支援格式化內容
 *   - 新增 sanitizeHTML 函式進行基本的 XSS 防護
 *   - 保留使用者訊息為純文字（安全考量）
 *   - ★ 新增 markdownToHTML 函式，支援 Markdown 語法轉換
 * 
 * ---------------------------------------------------------
 * 功能重點：
 * 1) 基本訊息串接與渲染（使用者/機器人）
 * 2) 免登入多使用者：以 localStorage 建立 clientId
 * 3) 思考中動畫控制（輸入禁用/解禁）
 * 4) 呼叫後端 /api/chat，強化回應解析與錯誤處理
 * 5) 當回傳物件為 {} 時，顯示「網路不穩定，請再試一次」
 * 6) 機器人回覆支援 HTML 格式渲染
 * 7) ★ 新增：支援 Markdown 語法自動轉換為 HTML
 *
 * 支援的 Markdown 語法：
 * - 標題：# H1, ## H2, ### H3, #### H4, ##### H5, ###### H6
 * - 粗體：**text** 或 __text__
 * - 斜體：*text* 或 _text_
 * - 刪除線：~~text~~
 * - 行內程式碼：`code`
 * - 程式碼區塊：```code``` 或 ```language code```
 * - 連結：[text](url)
 * - 圖片：![alt](url)
 * - 無序列表：- item 或 * item
 * - 有序列表：1. item
 * - 引用：> quote
 * - 水平線：--- 或 ***
 * - 換行：兩個空格 + 換行 或直接換行
 *
 * 依賴：
 * - 頁面需有以下元素：
 *   #messages, #txtInput, #btnSend, #thinking
 *
 * 注意：
 * - 本檔案為單純前端邏輯，不含任何打包或框架語法。
 * - 機器人回覆使用 innerHTML，需確保後端回傳內容安全
 */

"use strict";

/* =========================
   後端 API 網域（可依環境調整）
   ========================= */
const API_BASE = "https://standard-chartered-taipei-charity-dhfc.onrender.com";

/**
 * 組合完整 API 路徑
 * @param {string} p - API 路徑，例如 "/api/chat"
 * @returns {string} 完整的 API URL
 */
const api = (p) => `${API_BASE}${p}`;

/* =========================
   免登入多使用者：clientId
   - 以 localStorage 永續化
   - 預設使用 crypto.randomUUID()，若不支援則以時間戳+隨機碼
   ========================= */
const CID_KEY = "fourleaf_client_id";
let clientId = localStorage.getItem(CID_KEY);
if (!clientId) {
  // 優先使用 crypto.randomUUID()，較舊瀏覽器則用備援方案
  clientId =
    (crypto.randomUUID && crypto.randomUUID()) ||
    `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  localStorage.setItem(CID_KEY, clientId);
}

/* =========================
   DOM 參照
   ========================= */
const elMessages = document.getElementById("messages");   // 訊息容器
const elInput = document.getElementById("txtInput");      // 文字輸入框
const elBtnSend = document.getElementById("btnSend");     // 送出按鈕
const elThinking = document.getElementById("thinking");   // 思考動畫容器（如 spinner）

/* =========================
   訊息狀態（簡易記憶體）
   - 格式：{ id, role, text, ts, isHtml }
   - role 僅為 'user' | 'assistant'
   - isHtml: 標記是否以 HTML 渲染（僅機器人訊息為 true）
   ========================= */
/** @type {{id:string, role:'user'|'assistant', text:string, ts:number, isHtml?:boolean}[]} */
const messages = [];

/* =========================
   小工具函式
   ========================= */

/**
 * 產生唯一識別碼
 * @returns {string} 隨機字串
 */
const uid = () => Math.random().toString(36).slice(2);

/**
 * 平滑滾動至訊息區底部
 */
function scrollToBottom() {
  elMessages?.scrollTo({ top: elMessages.scrollHeight, behavior: "smooth" });
}

/**
 * ★ Markdown 轉 HTML 函式
 * 將 Markdown 格式的文字轉換為 HTML
 * 
 * 支援語法：
 * - 標題 (h1-h6)
 * - 粗體、斜體、刪除線
 * - 行內程式碼與程式碼區塊
 * - 連結與圖片
 * - 無序列表與有序列表
 * - 引用區塊
 * - 水平線
 * - 換行處理
 * 
 * @param {string} markdown - Markdown 格式的原始文字
 * @returns {string} 轉換後的 HTML 字串
 */
function markdownToHTML(markdown) {
  if (!markdown || typeof markdown !== 'string') {
    return '';
  }

  let html = markdown;

  // ========== 第一階段：保護特殊區塊 ==========
  // 用 placeholder 暫時替換，避免被其他規則影響

  // 儲存程式碼區塊（``` 包圍的多行程式碼）
  const codeBlocks = [];
  html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (match, lang, code) => {
    const index = codeBlocks.length;
    // 對程式碼內容進行 HTML 跳脫
    const escapedCode = code
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .trim();
    const langClass = lang ? ` class="language-${lang}"` : '';
    codeBlocks.push(`<pre><code${langClass}>${escapedCode}</code></pre>`);
    return `%%CODEBLOCK_${index}%%`;
  });

  // 儲存行內程式碼（` 包圍的程式碼）
  const inlineCodes = [];
  html = html.replace(/`([^`]+)`/g, (match, code) => {
    const index = inlineCodes.length;
    const escapedCode = code
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    inlineCodes.push(`<code>${escapedCode}</code>`);
    return `%%INLINECODE_${index}%%`;
  });

  // ========== 第二階段：處理區塊級元素 ==========

  // 水平線：--- 或 *** 或 ___ （獨立一行）
  html = html.replace(/^[\s]*[-*_]{3,}[\s]*$/gm, '<hr>');

  // 標題：# ~ ###### （支援 # 後有無空格）
  html = html.replace(/^###### (.+)$/gm, '<h6>$1</h6>');
  html = html.replace(/^##### (.+)$/gm, '<h5>$1</h5>');
  html = html.replace(/^#### (.+)$/gm, '<h4>$1</h4>');
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

  // 引用區塊：> quote（支援多行）
  html = html.replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>');
  // 合併連續的 blockquote
  html = html.replace(/<\/blockquote>\n<blockquote>/g, '\n');

  // 無序列表：- item 或 * item（支援巢狀需更複雜處理，這裡僅支援單層）
  html = html.replace(/^[\s]*[-*+] (.+)$/gm, '<li>$1</li>');
  
  // 有序列表：1. item
  html = html.replace(/^[\s]*\d+\. (.+)$/gm, '<li>$1</li>');

  // 將連續的 <li> 包裹成 <ul> 或 <ol>
  // 簡化處理：統一用 <ul> 包裹
  html = html.replace(/(<li>[\s\S]*?<\/li>)(\n<li>[\s\S]*?<\/li>)*/g, (match) => {
    return `<ul>${match}</ul>`;
  });

  // ========== 第三階段：處理行內元素 ==========

  // 圖片：![alt](url)
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" style="max-width:100%;">');

  // 連結：[text](url)
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

  // 粗體：**text** 或 __text__（需在斜體之前處理）
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');

  // 斜體：*text* 或 _text_
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  html = html.replace(/_(.+?)_/g, '<em>$1</em>');

  // 刪除線：~~text~~
  html = html.replace(/~~(.+?)~~/g, '<del>$1</del>');

  // ========== 第四階段：處理換行 ==========

  // 兩個空格 + 換行 → <br>
  html = html.replace(/  \n/g, '<br>\n');

  // 單獨換行轉 <br>（保留段落感）
  // 但要排除已經是 HTML 標籤結尾的情況
  html = html.replace(/([^>\n])\n([^<\n])/g, '$1<br>\n$2');

  // ========== 第五階段：還原保護的區塊 ==========

  // 還原行內程式碼
  inlineCodes.forEach((code, index) => {
    html = html.replace(`%%INLINECODE_${index}%%`, code);
  });

  // 還原程式碼區塊
  codeBlocks.forEach((block, index) => {
    html = html.replace(`%%CODEBLOCK_${index}%%`, block);
  });

  return html;
}

/**
 * 基本的 HTML 清理函式
 * - 允許常見的格式化標籤（如 <b>, <i>, <a>, <br>, <p>, <ul>, <li> 等）
 * - 移除可能造成 XSS 的危險標籤和屬性
 * 
 * 注意：這是基本防護，如需更嚴格的安全性，建議使用 DOMPurify 等專業函式庫
 * 
 * @param {string} html - 原始 HTML 字串
 * @returns {string} 清理後的 HTML 字串
 */
function sanitizeHTML(html) {
  // 允許的標籤清單（擴充以支援 Markdown 轉換後的標籤）
  const allowedTags = [
    'b', 'i', 'u', 'strong', 'em', 'del', 'br', 'p', 'div', 'span',
    'ul', 'ol', 'li', 'a', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'table', 'thead', 'tbody', 'tr', 'td', 'th',
    'blockquote', 'code', 'pre', 'hr', 'img'
  ];

  // 允許的屬性清單（針對特定標籤）
  const allowedAttributes = {
    'a': ['href', 'target', 'rel'],
    'img': ['src', 'alt', 'style', 'width', 'height'],
    'code': ['class'],
    'pre': ['class'],
    '*': ['class', 'style']  // 所有標籤都允許 class 和 style
  };

  // 建立暫存 DOM 元素進行解析
  const temp = document.createElement('div');
  temp.innerHTML = html;

  /**
   * 檢查屬性是否被允許
   * @param {string} tagName - 標籤名稱
   * @param {string} attrName - 屬性名稱
   * @returns {boolean} 是否允許
   */
  function isAttributeAllowed(tagName, attrName) {
    const tagAllowed = allowedAttributes[tagName] || [];
    const globalAllowed = allowedAttributes['*'] || [];
    return tagAllowed.includes(attrName) || globalAllowed.includes(attrName);
  }

  /**
   * 遞迴清理 DOM 節點
   * @param {Node} node - 要清理的節點
   */
  function cleanNode(node) {
    // 取得所有子節點的快照（避免迭代時被修改）
    const children = Array.from(node.childNodes);
    
    for (const child of children) {
      if (child.nodeType === Node.ELEMENT_NODE) {
        const tagName = child.tagName.toLowerCase();
        
        // 檢查是否為允許的標籤
        if (!allowedTags.includes(tagName)) {
          // 不允許的標籤：以其文字內容取代
          const textNode = document.createTextNode(child.textContent || '');
          node.replaceChild(textNode, child);
        } else {
          // 允許的標籤：檢查並移除危險屬性
          const attrs = Array.from(child.attributes);
          for (const attr of attrs) {
            const attrName = attr.name.toLowerCase();
            const attrValue = attr.value.toLowerCase();
            
            // 移除事件處理器
            if (attrName.startsWith('on')) {
              child.removeAttribute(attr.name);
              continue;
            }
            
            // 移除 javascript: 協定
            if (
              (attrName === 'href' || attrName === 'src') && 
              attrValue.startsWith('javascript:')
            ) {
              child.removeAttribute(attr.name);
              continue;
            }

            // 移除 data: 協定（可能用於 XSS）
            if (
              attrName === 'src' && 
              attrValue.startsWith('data:') &&
              !attrValue.startsWith('data:image/')
            ) {
              child.removeAttribute(attr.name);
              continue;
            }

            // 檢查是否為允許的屬性
            if (!isAttributeAllowed(tagName, attrName)) {
              child.removeAttribute(attr.name);
            }
          }
          // 遞迴處理子節點
          cleanNode(child);
        }
      }
    }
  }

  cleanNode(temp);
  return temp.innerHTML;
}

/**
 * 將純文字轉換為安全的 HTML（跳脫特殊字元）
 * 用於使用者輸入的訊息，防止 XSS
 * 
 * @param {string} text - 原始純文字
 * @returns {string} 跳脫後的安全字串
 */
function escapeHTML(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * 處理機器人回覆內容
 * 自動偵測並轉換 Markdown 格式，最後進行安全清理
 * 
 * @param {string} text - 原始回覆文字
 * @returns {string} 處理後的安全 HTML 字串
 */
function processReplyContent(text) {
  if (!text || typeof text !== 'string') {
    return '';
  }

  // 先進行 Markdown 轉換
  let html = markdownToHTML(text);
  
  // 再進行安全清理
  html = sanitizeHTML(html);
  
  return html;
}

/**
 * 切換「思考中」動畫與輸入狀態
 * @param {boolean} on - true 時顯示思考動畫並禁用輸入，false 時恢復
 */
function setThinking(on) {
  if (!elThinking) return;
  
  if (on) {
    // 顯示思考動畫，禁用輸入
    elThinking.classList.remove("hidden");
    if (elBtnSend) elBtnSend.disabled = true;
    if (elInput) elInput.disabled = true;
  } else {
    // 隱藏思考動畫，恢復輸入
    elThinking.classList.add("hidden");
    if (elBtnSend) elBtnSend.disabled = false;
    if (elInput) elInput.disabled = false;
    // 解除禁用後讓輸入框自動聚焦
    elInput?.focus();
  }
}

/* =========================
   將 messages 渲染到畫面
   - 使用者訊息：純文字（使用 escapeHTML 防護）
   - 機器人訊息：Markdown/HTML 格式（使用 processReplyContent 處理）
   ========================= */
function render() {
  if (!elMessages) return;
  
  // 清空現有內容
  elMessages.innerHTML = "";

  for (const m of messages) {
    const isUser = m.role === "user";

    // 外層容器 - 一則訊息的整列
    const row = document.createElement("div");
    row.className = `msg ${isUser ? "user" : "bot"}`;

    // 頭像圖片
    const avatar = document.createElement("img");
    avatar.className = "avatar";
    avatar.src = isUser
      ? "https://raw.githubusercontent.com/justin-321-hub/standard_chartered_taipei_charity_marathon/refs/heads/main/assets/user.png"
      : "https://raw.githubusercontent.com/justin-321-hub/standard_chartered_taipei_charity_marathon/refs/heads/main/assets/S__53714948.png";
    avatar.alt = isUser ? "you" : "bot";

    // 對話泡泡
    const bubble = document.createElement("div");
    bubble.className = "bubble";

    /**
     * ★ 關鍵修改：根據訊息角色決定渲染方式
     * - 使用者訊息：使用 escapeHTML 後以 innerHTML 設定（保持純文字安全）
     * - 機器人訊息：使用 processReplyContent 處理 Markdown 並清理 HTML
     */
    if (isUser) {
      // 使用者訊息：純文字渲染（安全跳脫）
      bubble.innerHTML = escapeHTML(m.text);
    } else {
      // 機器人訊息：Markdown + HTML 格式渲染
      bubble.innerHTML = processReplyContent(m.text);
    }

    // 組合元素
    row.appendChild(avatar);
    row.appendChild(bubble);
    elMessages.appendChild(row);
  }

  // 滾動到最新訊息
  scrollToBottom();
}

/* =========================
   呼叫後端 API 並處理回應
   - 入口：sendText(text?)
   - 若無 text 參數，則取 input 欄位的值
   ========================= */
async function sendText(text) {
  // 取得並清理輸入內容
  const content = (text ?? elInput?.value ?? "").trim();
  if (!content) return; // 空白內容不送出

  // 建立使用者訊息物件並加入陣列
  const userMsg = { 
    id: uid(), 
    role: "user", 
    text: content, 
    ts: Date.now(),
    isHtml: false  // 使用者訊息不使用 HTML 渲染
  };
  messages.push(userMsg);
  
  // 清空輸入框
  if (elInput) elInput.value = "";
  
  // 立即渲染使用者訊息
  render();

  // 顯示思考中動畫（等待回覆期間）
  setThinking(true);

  try {
    // 呼叫後端 /api/chat
    const res = await fetch(api("/api/chat"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Client-Id": clientId,
      },
      body: JSON.stringify({ 
        text: content, 
        clientId, 
        language: "繁體中文"
      }),
    });

    // 以文字讀取回應（避免直接 .json() 遇到空字串拋錯）
    const raw = await res.text();

    // 嘗試 JSON 解析
    let data;
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch {
      // JSON 解析失敗，保留原始字串供除錯
      data = { errorRaw: raw };
    }

    // HTTP 狀態非 2xx 時拋出錯誤
    if (!res.ok) {
      // 特別處理 502 / 404 錯誤
      if (res.status === 502 || res.status === 404) {
        throw new Error("網路不穩定，請再試一次!");
      }

      // 使用後端提供的錯誤訊息
      const serverMsg =
        (data && (data.error || data.body || data.message)) ?? raw ?? "unknown error";
      throw new Error(`HTTP ${res.status} ${res.statusText} — ${serverMsg}`);
    }

    /**
     * 整理機器人要顯示的內容
     * 規則：
     * 1) 若 data 是字串，直接當回覆
     * 2) 若 data 是物件，優先用 data.text 或 data.message
     * 3) 若是空物件 {} → 顯示「網路不穩定，請再試一次」
     * 4) 其他物件 → JSON 字串化後顯示（利於除錯）
     */
    let replyText;
    if (typeof data === "string") {
      replyText = data.trim() || "（空白回覆）";
    } else if (data && (data.text || data.message)) {
      replyText = String(data.text || data.message);
    } else {
      // data 不是字串，也沒有 text/message 欄位
      const isPlainEmptyObject =
        data &&
        typeof data === "object" &&
        !Array.isArray(data) &&
        Object.keys(data).length === 0;

      replyText = isPlainEmptyObject
        ? "網路不穩定，請再試一次"
        : JSON.stringify(data, null, 2);
    }

    // 建立機器人訊息物件
    const botMsg = { 
      id: uid(), 
      role: "assistant", 
      text: replyText, 
      ts: Date.now(),
      isHtml: true  // 機器人訊息使用 HTML 渲染
    };
    messages.push(botMsg);

    // 關閉思考動畫並重新渲染
    setThinking(false);
    render();

  } catch (err) {
    // 發生錯誤時關閉思考動畫
    setThinking(false);

    // 組合友善的錯誤訊息
    const friendly =
      // 離線狀態提示
      (!navigator.onLine && "目前處於離線狀態，請檢查網路連線後再試一次") ||
      // 其他錯誤訊息
      `${err?.message || err}`;

    // 建立錯誤訊息物件（也以 HTML 格式顯示）
    const botErr = {
      id: uid(),
      role: "assistant",
      text: friendly,
      ts: Date.now(),
      isHtml: true
    };
    messages.push(botErr);
    render();
  }
}

/* =========================
   事件綁定
   ========================= */

// 點擊送出按鈕
elBtnSend?.addEventListener("click", () => sendText());

// 鍵盤事件：Enter 送出（Shift+Enter 換行）
elInput?.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault(); // 防止預設的換行行為
    sendText();
  }
});

// 頁面載入完成後讓輸入框聚焦
window.addEventListener("load", () => elInput?.focus());

/* =========================
   初始化歡迎訊息
   - 支援 Markdown 格式
   ========================= */
messages.push({
  id: uid(),
  role: "assistant",
  text:
    "Hi，我是 **Sky**，我喜歡跑步，熱心公益又充滿正能量，對賽事的各個環節瞭如指掌，希望能以我的專業滿足您的服務需求。\n\n如果有關於**渣打臺北公益馬拉松**的大小事，歡迎詢問我！",
  ts: Date.now(),
  isHtml: true
});
render();
