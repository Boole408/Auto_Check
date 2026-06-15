const DEFAULT_APP_URL = "https://autocw.ccwu.cc";

const PROVIDERS = [
  {
    id: "muyuan",
    label: "MUYUAN",
    hosts: ["muyuan.do"],
    userEndpoint: "/api/user/self"
  },
  {
    id: "xem8k5",
    label: "XEM8K5",
    hosts: ["new.xem8k5.top"],
    userEndpoint: "/api/user/self"
  },
  {
    id: "dgbmc",
    label: "DGBMC",
    hosts: ["freeapi.dgbmc.top"],
    userEndpoint: "/api/user/self"
  },
  {
    id: "jiuuij",
    label: "JIUUIJ",
    hosts: ["jiuuij.de5.net"],
    userEndpoint: "/api/user/self"
  },
  {
    id: "anyrouter",
    label: "Any Router",
    hosts: ["anyrouter.top"],
    userEndpoint: "/api/user/self"
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

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
}

async function getCookieHeader(url) {
  const cookies = await chrome.cookies.getAll({ url });
  return cookies
    .filter((cookie) => cookie.name && cookie.value)
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join("; ");
}

function buildCurlContent(origin, endpoint, cookieHeader) {
  return `curl '${origin}${endpoint}' -H 'accept: application/json' -H 'cookie: ${cookieHeader}'`;
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
  const cookieHeader = await getCookieHeader(origin + "/");
  if (!cookieHeader) {
    activeContext = null;
    setStatus(`没有读取到 ${provider.label} Cookie，请确认已网页登录。`, "error");
    return;
  }

  activeContext = {
    provider,
    origin,
    cookieHeader
  };
  importButton.disabled = false;
  setStatus(`已识别 ${provider.label}，读取到 ${cookieHeader.split(";").length} 个 Cookie。`, "ok");
}

async function importCurrentAccount() {
  if (!activeContext) return;

  importButton.disabled = true;
  setStatus("正在导入到 Auto_CW...", "muted");

  try {
    const appUrl = normalizeAppUrl(appUrlInput.value);
    await saveAppUrl(appUrl);

    const content = buildCurlContent(
      activeContext.origin,
      activeContext.provider.userEndpoint,
      activeContext.cookieHeader
    );
    const response = await fetch(`${appUrl}/api/quota-monitor/accounts/import`, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        provider: activeContext.provider.id,
        format: "auto",
        content
      })
    });
    const payload = await response.json().catch(() => null);

    if (!response.ok || payload?.success === false) {
      if (response.status === 401) {
        throw new Error("Auto_CW 未登录，请先打开控制台登录一次。");
      }
      throw new Error(payload?.message || "导入失败，请稍后重试。");
    }

    const importedCount = payload?.data?.importedCount ?? 1;
    const totalCount = payload?.data?.count ?? "";
    setStatus(`导入成功：新增/更新 ${importedCount} 个账号${totalCount ? `，当前共 ${totalCount} 个` : ""}。`, "ok");
  } catch (error) {
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
