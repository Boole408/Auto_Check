const DEFAULT_APP_URL = "https://autocw.ccwu.cc";

const PROVIDERS = [
  {
    id: "muyuan",
    label: "MUYUAN",
    hosts: ["muyuan.do"],
    userEndpoints: ["/api/user/self", "/api/user/info", "/api/user"]
  },
  {
    id: "xem8k5",
    label: "XEM8K5",
    hosts: ["new.xem8k5.top"],
    userEndpoints: ["/api/user/self", "/api/user/info", "/api/user"]
  },
  {
    id: "dgbmc",
    label: "DGBMC",
    hosts: ["freeapi.dgbmc.top"],
    userEndpoints: ["/api/user/self", "/api/user/info", "/api/user"]
  },
  {
    id: "jiuuij",
    label: "JIUUIJ",
    hosts: ["jiuuij.de5.net"],
    userEndpoints: ["/api/user/self", "/api/user/info", "/api/user"]
  },
  {
    id: "anyrouter",
    label: "Any Router",
    hosts: ["anyrouter.top"],
    userEndpoints: ["/api/user/self", "/api/user/info", "/api/user"]
  }
];

const appUrlInput = document.querySelector("#appUrl");
const importButton = document.querySelector("#importButton");
const statusEl = document.querySelector("#status");

let activeContext = null;

function setStatus(message, tone = "muted") {
  statusEl.textContent = message;
  statusEl.dataset.tone = tone;
}

function trimTrailingSlash(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function normalizeAppUrl(value) {
  const rawUrl = trimTrailingSlash(value || DEFAULT_APP_URL);
  const url = new URL(rawUrl);
  if (!/^https?:$/.test(url.protocol)) {
    throw new Error("Auto_CW 地址必须是 http 或 https");
  }
  return trimTrailingSlash(url.toString());
}

function getProviderForUrl(tabUrl) {
  let url;
  try {
    url = new URL(tabUrl);
  } catch {
    return null;
  }

  return (
    PROVIDERS.find((provider) =>
      provider.hosts.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))
    ) || null
  );
}

function countCookiePairs(cookieHeader = "") {
  return String(cookieHeader || "")
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean).length;
}

function mergeCookieHeaders(...headers) {
  const pairs = new Map();
  for (const header of headers) {
    for (const entry of String(header || "").split(";")) {
      const normalized = entry.trim();
      const separatorIndex = normalized.indexOf("=");
      if (separatorIndex <= 0) continue;
      pairs.set(normalized.slice(0, separatorIndex), normalized.slice(separatorIndex + 1));
    }
  }
  return Array.from(pairs, ([name, value]) => `${name}=${value}`).join("; ");
}

function cookieObjectsToHeader(cookies = []) {
  const pairs = new Map();
  for (const cookie of cookies) {
    if (!cookie?.name || !cookie?.value) continue;
    pairs.set(cookie.name, cookie.value);
  }
  return Array.from(pairs)
    .sort(([leftName], [rightName]) => leftName.localeCompare(rightName))
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
}

async function getCookiesSafely(details) {
  try {
    return await chrome.cookies.getAll(details);
  } catch {
    return [];
  }
}

async function getCookieHeader(tabUrl) {
  const url = new URL(tabUrl);
  const lookupResults = await Promise.all([
    getCookiesSafely({ url: url.origin + "/" }),
    getCookiesSafely({ url: tabUrl }),
    getCookiesSafely({ domain: url.hostname }),
    getCookiesSafely({ domain: `.${url.hostname}` }),
    getCookiesSafely({
      url: url.origin + "/",
      partitionKey: { topLevelSite: url.origin }
    })
  ]);

  const matchingCookies = lookupResults
    .flat()
    .filter((cookie) => {
      const domain = String(cookie.domain || "").replace(/^\./, "");
      return domain === url.hostname || url.hostname.endsWith(`.${domain}`);
    });

  return cookieObjectsToHeader(matchingCookies);
}

async function inspectCurrentPage(tabId, endpoints) {
  try {
    const [{ result } = {}] = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (selfEndpoints) => {
        function unwrap(payload) {
          if (!payload || typeof payload !== "object") return payload;
          return payload.data && typeof payload.data === "object" ? payload.data : payload;
        }

        function readPath(object, paths) {
          for (const path of paths) {
            const parts = String(path).split(".");
            let current = object;
            for (const part of parts) {
              if (current == null || typeof current !== "object" || !(part in current)) {
                current = undefined;
                break;
              }
              current = current[part];
            }
            if (current !== undefined && current !== null && current !== "") return current;
          }
          return "";
        }

        function parseMaybeJson(value) {
          if (!value || typeof value !== "string") return null;
          try {
            return JSON.parse(value);
          } catch {
            return null;
          }
        }

        function readStorage(storage, area) {
          const entries = [];
          try {
            for (let index = 0; index < storage.length; index += 1) {
              const key = storage.key(index);
              entries.push({
                area,
                key,
                value: storage.getItem(key)
              });
            }
          } catch {
            // Some pages disallow a storage area.
          }
          return entries;
        }

        function isUsableToken(value, key = "") {
          const token = String(value || "")
            .replace(/^Bearer\s+/i, "")
            .trim();
          if (token.length < 12 || token.length > 2000) return "";
          if (/^sk-[A-Za-z0-9_-]+/.test(token)) return "";
          if (/\*/.test(token)) return "";
          if (/api[_-]?key/i.test(key) && /^sk-/i.test(token)) return "";
          if (/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) return token;
          if (/token|jwt|auth|session/i.test(key) && /^[A-Za-z0-9._~+/=-]+$/.test(token)) {
            return token;
          }
          return "";
        }

        function collectCandidates(value, key = "", state = { tokens: [], users: [] }, depth = 0) {
          if (depth > 8 || value == null) return state;
          if (typeof value === "string") {
            const parsed = parseMaybeJson(value);
            if (parsed) collectCandidates(parsed, key, state, depth + 1);
            const token = isUsableToken(value, key);
            if (token && !state.tokens.includes(token)) state.tokens.push(token);
            return state;
          }
          if (Array.isArray(value)) {
            value.forEach((item) => collectCandidates(item, key, state, depth + 1));
            return state;
          }
          if (typeof value !== "object") return state;

          const username = readPath(value, [
            "username",
            "user.username",
            "email",
            "user.email",
            "name",
            "user.name",
            "displayName",
            "display_name",
            "user.displayName",
            "user.display_name"
          ]);
          const userId = readPath(value, ["id", "userId", "user_id", "user.id", "user.userId", "user.user_id"]);
          if ((username || userId) && !state.users.includes(value)) {
            state.users.push(value);
          }

          for (const [childKey, childValue] of Object.entries(value)) {
            const token = isUsableToken(childValue, childKey);
            if (token && !state.tokens.includes(token)) state.tokens.push(token);
            collectCandidates(childValue, childKey, state, depth + 1);
          }
          return state;
        }

        async function fetchSelf(tokens) {
          const headerSets = [
            {},
            ...tokens.flatMap((token) => [
              { Authorization: `Bearer ${token}` },
              { "New-API-Token": token },
              { Authorization: `Bearer ${token}`, "New-API-Token": token }
            ])
          ];

          for (const endpoint of selfEndpoints) {
            for (const headers of headerSets) {
              try {
                const response = await fetch(endpoint, {
                  credentials: "include",
                  headers: {
                    Accept: "application/json",
                    ...headers
                  }
                });
                if ([400, 401, 403, 404, 405].includes(response.status)) continue;
                if (!response.ok) continue;
                const payload = await response.json();
                if (payload?.success === false) continue;
                const user = unwrap(payload);
                if (user && typeof user === "object") return user;
              } catch {
                // Try the next endpoint/header pair.
              }
            }
          }
          return null;
        }

        const entries = [
          ...readStorage(window.localStorage, "localStorage"),
          ...readStorage(window.sessionStorage, "sessionStorage")
        ];
        const candidates = { tokens: [], users: [] };
        entries.forEach((entry) => collectCandidates(entry.value, entry.key, candidates));
        const fetchedUser = await fetchSelf(candidates.tokens.slice(0, 8));

        return {
          documentCookie: document.cookie || "",
          storageCount: entries.length,
          storageKeys: entries.map((entry) => `${entry.area}.${entry.key}`).slice(0, 24),
          token: candidates.tokens[0] || "",
          user: fetchedUser || candidates.users[0] || null
        };
      },
      args: [endpoints]
    });
    return result || null;
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "无法读取页面存储"
    };
  }
}

function readPath(object, paths) {
  for (const path of paths) {
    const parts = String(path).split(".");
    let current = object;
    for (const part of parts) {
      if (current == null || typeof current !== "object" || !(part in current)) {
        current = undefined;
        break;
      }
      current = current[part];
    }
    if (current !== undefined && current !== null && current !== "") return current;
  }
  return "";
}

function cleanName(value, fallback = "") {
  return String(value || fallback || "")
    .trim()
    .replace(/^["']|["']$/g, "");
}

function buildAccountFromPageContext(pageContext) {
  const user = pageContext?.user;
  const token = cleanName(pageContext?.token);
  if (!user || typeof user !== "object" || !token) return null;

  const userId = cleanName(
    readPath(user, ["id", "userId", "user_id", "user.id", "user.userId", "user.user_id"])
  );
  const displayName = cleanName(
    readPath(user, [
      "displayName",
      "display_name",
      "nickname",
      "name",
      "username",
      "email",
      "user.displayName",
      "user.display_name",
      "user.nickname",
      "user.name",
      "user.username"
    ]),
    userId
  );
  const username = cleanName(
    readPath(user, [
      "username",
      "email",
      "name",
      "displayName",
      "display_name",
      "nickname",
      "user.username",
      "user.email",
      "user.name"
    ]),
    displayName || userId
  );

  if (!username) return null;
  return {
    username,
    token,
    authType: "token",
    loginProvider: "web",
    ...(userId ? { userId } : {}),
    ...(displayName ? { displayName } : {})
  };
}

function buildCurlContent(origin, endpoint, cookieHeader) {
  return `curl '${origin}${endpoint}' -H 'accept: application/json' -H 'cookie: ${cookieHeader}'`;
}

function encodeRelayPayload(payload) {
  const json = JSON.stringify(payload);
  return btoa(unescape(encodeURIComponent(json)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function openAutoCwRelay(appUrl, payload) {
  const encodedPayload = encodeRelayPayload(payload);
  await chrome.tabs.create({
    url: `${appUrl}/quota-monitor#auto-cw-import=${encodeURIComponent(encodedPayload)}`
  });
}

async function loadStoredSettings() {
  const settings = await chrome.storage.local.get({ appUrl: DEFAULT_APP_URL });
  appUrlInput.value = settings.appUrl || DEFAULT_APP_URL;
}

async function saveAppUrl(value) {
  await chrome.storage.local.set({ appUrl: normalizeAppUrl(value) });
}

async function refreshActiveContext() {
  importButton.disabled = true;
  const tab = await getActiveTab();
  if (!tab?.url) {
    activeContext = null;
    setStatus("没有读取到当前标签页。", "error");
    return;
  }

  const provider = getProviderForUrl(tab.url);
  if (!provider) {
    activeContext = null;
    setStatus("请先切到已登录的 MUYUAN 或其它已配置站点页面。", "error");
    return;
  }

  const url = new URL(tab.url);
  const origin = url.origin;
  const chromeCookieHeader = await getCookieHeader(tab.url);
  const pageContext = await inspectCurrentPage(tab.id, provider.userEndpoints);
  const cookieHeader = mergeCookieHeaders(chromeCookieHeader, pageContext?.documentCookie);
  const account = buildAccountFromPageContext(pageContext);

  if (!cookieHeader && !account) {
    activeContext = null;
    const storageHint = pageContext?.storageCount
      ? `已看到 ${pageContext.storageCount} 个浏览器存储项，但没找到可导入 token。`
      : "页面存储也没有读到可用登录态。";
    setStatus(
      `没有读取到可导入的 ${provider.label} Cookie/token。${storageHint} 请在扩展详情里确认已允许读取 ${url.hostname}，或用 Network 复制 cURL 导入。`,
      "error"
    );
    return;
  }

  activeContext = {
    provider,
    origin,
    cookieHeader,
    account
  };
  importButton.disabled = false;

  const cookieCount = countCookiePairs(cookieHeader);
  if (cookieCount > 0) {
    const tokenText = account ? "同时找到页面 token" : "未找到页面 token";
    setStatus(`已识别 ${provider.label}：Cookie ${cookieCount} 个，${tokenText}。可以导入。`, "ok");
    return;
  }

  setStatus(
    `已识别 ${provider.label} 页面用户，但没有读到 Cookie，只能尝试 token 导入；服务器会先验证，不可用就不会保存。`,
    "muted"
  );
}

async function importCurrentAccount() {
  if (!activeContext) return;

  importButton.disabled = true;
  setStatus("\u6b63\u5728\u5bfc\u5165\u5230 Auto_CW...", "muted");
  let appUrl = "";
  let importPayload = null;

  try {
    appUrl = normalizeAppUrl(appUrlInput.value);
    await saveAppUrl(appUrl);

    const hasCookie = Boolean(activeContext.cookieHeader);

    if (hasCookie) {
      const endpoint = activeContext.provider.userEndpoints[0];
      let validatedUser = null;
      try {
        const resp = await fetch(`${activeContext.origin}${endpoint}`, { credentials: "include" });
        if (resp.ok) {
          const payload = await resp.json().catch(() => null);
          if (payload?.success !== false) {
            const raw = payload?.data && typeof payload.data === "object" ? payload.data : payload;
            if (raw && typeof raw === "object") validatedUser = raw;
          }
        }
      } catch {}

      if (!validatedUser) {
        setStatus("\u6d4f\u89c8\u5668\u65e0\u6cd5\u9a8c\u8bc1\u5f53\u524d Cookie \u662f\u5426\u6709\u6548\uff0c\u5c1d\u8bd5\u670d\u52a1\u5668\u7aef\u9a8c\u8bc1...", "muted");
      }

      const userId = validatedUser ? String(
        validatedUser.id || validatedUser.userId || validatedUser.user_id ||
        validatedUser.data?.id || validatedUser.data?.userId || ""
      ).trim() : "";
      const username = validatedUser ? String(
        validatedUser.username || validatedUser.email || validatedUser.name ||
        validatedUser.displayName || validatedUser.display_name ||
        validatedUser.data?.username || validatedUser.data?.email || ""
      ).trim() : "";
      const displayName = validatedUser ? String(
        validatedUser.displayName || validatedUser.display_name || validatedUser.nickname ||
        validatedUser.name || validatedUser.username ||
        validatedUser.data?.displayName || validatedUser.data?.display_name || ""
      ).trim() : "";

      if (username) {
        importPayload = {
          provider: activeContext.provider.id,
          account: {
            username,
            cookie: activeContext.cookieHeader,
            ...(userId ? { userId } : {}),
            ...(displayName ? { displayName } : {}),
            authType: "cookie",
            loginProvider: "web"
          }
        };
      } else {
        importPayload = {
          provider: activeContext.provider.id,
          format: "auto",
          content: buildCurlContent(
            activeContext.origin,
            activeContext.provider.userEndpoints[0],
            activeContext.cookieHeader
          )
        };
      }
    } else if (activeContext.account) {
      importPayload = {
        provider: activeContext.provider.id,
        account: {
          username: activeContext.account.username,
          token: activeContext.account.token,
          ...(activeContext.account.userId ? { userId: activeContext.account.userId } : {}),
          ...(activeContext.account.displayName ? { displayName: activeContext.account.displayName } : {}),
          authType: "token",
          loginProvider: "web"
        }
      };
    } else {
      setStatus("\u6ca1\u6709\u53ef\u5bfc\u5165\u7684\u767b\u5f55\u4fe1\u606f", "error");
      return;
    }

    const response = await fetch(`${appUrl}/api/quota-monitor/accounts/import`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(importPayload)
    });
    const payload = await response.json().catch(() => null);

    if (!response.ok || payload?.success === false) {
      if (response.status === 401) {
        await openAutoCwRelay(appUrl, importPayload);
        setStatus("\u6269\u5c55\u76f4\u8fde\u672a\u5e26 Auto_CW \u767b\u5f55\u6001\uff0c\u5df2\u6253\u5f00 Auto_CW \u9875\u9762\u63a5\u529b\u5bfc\u5165\uff1b\u5982\u679c\u770b\u5230\u767b\u5f55\u9875\uff0c\u8bf7\u767b\u5f55\u540e\u518d\u70b9\u4e00\u6b21\u6269\u5c55\u5bfc\u5165\u3002", "ok");
        return;
      }
      throw new Error(payload?.message || "\u5bfc\u5165\u5931\u8d25\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5");
    }

    const importedCount = payload?.data?.importedCount ?? 1;
    const totalCount = payload?.data?.count ?? "";
    setStatus(`\u5bfc\u5165\u6210\u529f\uff1a\u65b0\u589e/\u66f4\u65b0 ${importedCount} \u4e2a\u8d26\u53f7${totalCount ? `\uff0c\u5f53\u524d\u5171 ${totalCount} \u4e2a` : ""}\u3002`, "ok");
  } catch (error) {
    if (appUrl && importPayload && error instanceof TypeError) {
      await openAutoCwRelay(appUrl, importPayload);
      setStatus("\u6269\u5c55\u76f4\u8fde Auto_CW \u5931\u8d25\uff0c\u5df2\u6253\u5f00 Auto_CW \u9875\u9762\u63a5\u529b\u5bfc\u5165\u3002", "ok");
      importButton.disabled = false;
      return;
    }
    setStatus(error instanceof Error ? error.message : "\u5bfc\u5165\u5931\u8d25\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5", "error");
  } finally {
    importButton.disabled = false;
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  try {
    await loadStoredSettings();
    await refreshActiveContext();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "扩展初始化失败。", "error");
  }
});

appUrlInput.addEventListener("change", () => {
  saveAppUrl(appUrlInput.value).catch((error) => {
    setStatus(error instanceof Error ? error.message : "保存 Auto_CW 地址失败。", "error");
  });
});

importButton.addEventListener("click", () => {
  importCurrentAccount();
});
