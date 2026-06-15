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
  const tokenText = account ? "已找到网页登录 token" : "未找到网页登录 token";
  setStatus(`已识别 ${provider.label}：Cookie ${cookieCount} 个，${tokenText}。可以导入。`, "ok");
}

async function importCurrentAccount() {
  if (!activeContext) return;

  importButton.disabled = true;
  setStatus("正在导入到 Auto_CW...", "muted");
  let appUrl = "";
  let importPayload = null;

  try {
    appUrl = normalizeAppUrl(appUrlInput.value);
    await saveAppUrl(appUrl);

    const hasCookie = Boolean(activeContext.cookieHeader);
    const content = hasCookie
      ? buildCurlContent(
          activeContext.origin,
          activeContext.provider.userEndpoints[0],
          activeContext.cookieHeader
        )
      : JSON.stringify([activeContext.account], null, 2);
    importPayload = {
      provider: activeContext.provider.id,
      format: hasCookie ? "auto" : "json",
      content
    };

    const response = await fetch(`${appUrl}/api/quota-monitor/accounts/import`, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(importPayload)
    });
    const payload = await response.json().catch(() => null);

    if (!response.ok || payload?.success === false) {
      if (response.status === 401) {
        await openAutoCwRelay(appUrl, importPayload);
        setStatus("扩展直连未带上 Auto_CW 登录态，已打开 Auto_CW 页面接力导入；如果看到登录页，请登录后再点一次扩展导入。", "ok");
        return;
      }
      throw new Error(payload?.message || "导入失败，请稍后重试。");
    }

    const importedCount = payload?.data?.importedCount ?? 1;
    const totalCount = payload?.data?.count ?? "";
    setStatus(`导入成功：新增/更新 ${importedCount} 个账号${totalCount ? `，当前共 ${totalCount} 个` : ""}。`, "ok");
  } catch (error) {
    if (appUrl && importPayload && error instanceof TypeError) {
      await openAutoCwRelay(appUrl, importPayload);
      setStatus("扩展直连 Auto_CW 失败，已打开 Auto_CW 页面接力导入。", "ok");
      importButton.disabled = false;
      return;
    }
    setStatus(error instanceof Error ? error.message : "导入失败，请稍后重试。", "error");
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
