import express from "express";
import {
  backupAccountFile,
  loadAccounts,
  mergeAccounts,
  parseAccountsContent,
  saveAccounts
} from "../utils/accountLoader.js";
import { requireAuth } from "../utils/auth.js";
import {
  checkinAccount,
  clearDashboardCache,
  getDashboard,
  getQuotaProviders,
  isRateLimitError,
  startOrResumeCheckinQueue
} from "../utils/caowo.js";
import { getProviderConfig, normalizeProviderId } from "../utils/siteProviders.js";

const router = express.Router();

function ok(res, data, message = "ok") {
  res.json({ success: true, message, data });
}

function sendEmptyAccounts(res) {
  res.status(400).json({
    success: false,
    message: "未读取到账号，请检查当前站点账号文件",
    data: null
  });
}

function unwrap(payload) {
  if (!payload || typeof payload !== "object") return payload;
  return payload.data && typeof payload.data === "object" ? payload.data : payload;
}

function readPath(object, paths) {
  for (const pathSpec of paths) {
    const parts = String(pathSpec).split(".");
    let current = object;
    for (const part of parts) {
      if (current == null || typeof current !== "object" || !(part in current)) {
        current = undefined;
        break;
      }
      current = current[part];
    }
    if (current != null && current !== "") return current;
  }
  return "";
}

function parseCurlHeaderArgs(content) {
  const headers = {};
  const headerPattern = /(?:^|\s)(?:-H|--header)\s+(?:"([^"]*)"|'([^']*)'|([^\s]+))/gi;
  let match;

  while ((match = headerPattern.exec(content))) {
    const rawHeader = String(match[1] || match[2] || match[3] || "").trim();
    const separatorIndex = rawHeader.indexOf(":");
    if (separatorIndex <= 0) continue;

    const name = rawHeader.slice(0, separatorIndex).trim().toLowerCase();
    const value = rawHeader.slice(separatorIndex + 1).trim();
    if (name && value) headers[name] = value;
  }

  return headers;
}

function parseCurlCookieArg(content) {
  const cookieArgPattern = /(?:^|\s)(?:-b|--cookie)\s+(?:"([^"]*)"|'([^']*)'|([^\r\n]+?)(?=\s+-|$))/i;
  const match = String(content).match(cookieArgPattern);
  return String(match?.[1] || match?.[2] || match?.[3] || "").trim();
}

function parseCookieFromCurl(content) {
  const source = String(content || "");
  if (!/^\s*curl\s+/i.test(source) && !/(?:^|\s)(?:-H|--header)\s+["']?cookie\s*:/i.test(source)) {
    return "";
  }

  const headers = parseCurlHeaderArgs(source);
  return headers.cookie || parseCurlCookieArg(source);
}

function sanitizeDisplayName(value, fallback = "") {
  return String(value || fallback || "")
    .replace(/：/g, ":")
    .replace(/，/g, ",")
    .replace(/；/g, ";")
    .trim()
    .replace(/^(?:账号|用户名|username|user)\s*[:=]\s*/i, "")
    .replace(/\s*(?:密码|password|pass)\s*[:=].*$/i, "")
    .split(/[;,]/)[0]
    .trim()
    .replace(/^["']|["']$/g, "");
}

async function fetchImportedCookieUser(providerId, cookie, signal) {
  const provider = getProviderConfig(providerId);
  const endpoints = ["/api/user/self", "/api/user/info", "/api/user"];

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(new URL(endpoint, provider.baseUrl), {
        signal,
        headers: {
          Accept: "application/json",
          Cookie: cookie,
          "User-Agent": "AutoCheck/1.0"
        }
      });
      if ([400, 401, 403, 404, 405].includes(response.status)) continue;
      if (!response.ok) continue;

      const payload = await response.json();
      if (payload?.success === false) continue;
      const data = unwrap(payload) || {};
      if (data && typeof data === "object") return data;
    } catch {
      // Try the next compatible account endpoint.
    }
  }

  return null;
}

async function fetchImportedTokenUser(providerId, token, signal) {
  const cleanToken = String(token || "").replace(/^Bearer\s+/i, "").trim();
  if (!cleanToken || /^sk-[A-Za-z0-9_-]+/i.test(cleanToken)) return null;

  const provider = getProviderConfig(providerId);
  const endpoints = ["/api/user/self", "/api/user/info", "/api/user"];
  const headerSets = [
    { Authorization: `Bearer ${cleanToken}` },
    { "New-API-Token": cleanToken },
    { Authorization: `Bearer ${cleanToken}`, "New-API-Token": cleanToken }
  ];

  for (const endpoint of endpoints) {
    for (const headers of headerSets) {
      try {
        const response = await fetch(new URL(endpoint, provider.baseUrl), {
          signal,
          headers: {
            Accept: "application/json",
            "User-Agent": "AutoCheck/1.0",
            ...headers
          }
        });
        if ([400, 401, 403, 404, 405].includes(response.status)) continue;
        if (!response.ok) continue;

        const payload = await response.json();
        if (payload?.success === false) continue;
        const data = unwrap(payload) || {};
        if (data && typeof data === "object") return data;
      } catch {
        // Try the next compatible account endpoint/header pair.
      }
    }
  }

  return null;
}

function readImportedUserFields(user, fallback = {}) {
  const userId = String(
    readPath(user, ["id", "user_id", "userId", "user.id", "user.user_id", "user.userId"]) ||
      fallback.userId ||
      ""
  ).trim();
  const displayName = sanitizeDisplayName(
    readPath(user, [
      "display_name",
      "displayName",
      "nickname",
      "name",
      "username",
      "email",
      "user.display_name",
      "user.displayName",
      "user.nickname",
      "user.name",
      "user.username"
    ]) || fallback.displayName,
    userId
  );
  const username = sanitizeDisplayName(
    readPath(user, [
      "username",
      "email",
      "name",
      "display_name",
      "displayName",
      "nickname",
      "user.username",
      "user.email",
      "user.name"
    ]) || fallback.username,
    displayName || userId
  );

  return { userId, displayName, username };
}

function buildAccountFromImportedUser(user, cookie) {
  const { userId, displayName, username } = readImportedUserFields(user);
  if (!username) return null;

  return {
    username,
    cookie,
    authType: "cookie",
    loginProvider: "web",
    ...(userId ? { userId } : {}),
    ...(displayName ? { displayName } : {})
  };
}

function buildTokenAccountFromImportedUser(user, token, fallback = {}) {
  const { userId, displayName, username } = readImportedUserFields(user, fallback);
  if (!username) return null;

  return {
    username,
    token: String(token || "").replace(/^Bearer\s+/i, "").trim(),
    authType: "token",
    loginProvider: "web",
    ...(userId ? { userId } : {}),
    ...(displayName ? { displayName } : {})
  };
}

async function parseCurlAccountContent(providerId, content) {
  const cookie = parseCookieFromCurl(content);
  if (!cookie) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);

  try {
    const user = await fetchImportedCookieUser(providerId, cookie, controller.signal);
    const account = user ? buildAccountFromImportedUser(user, cookie) : null;
    return {
      cookie,
      account,
      userLoaded: Boolean(user)
    };
  } finally {
    clearTimeout(timer);
  }
}

function needsSessionValidation(account) {
  if (!account || typeof account !== "object") return false;
  if (account.cookie) return true;
  if (account.token && !account.password) return true;
  return false;
}

async function validateImportedSessionAccounts(providerId, accounts) {
  const validatedAccounts = [];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);

  try {
    for (const account of accounts) {
      if (!needsSessionValidation(account)) {
        validatedAccounts.push(account);
        continue;
      }

      if (account.cookie) {
        const user = await fetchImportedCookieUser(providerId, account.cookie, controller.signal);
        if (!user) {
          return {
            ok: false,
            message:
              "导入内容里的 Cookie 服务器端验证失败，已拒绝保存，避免导入后不可用。请确认复制的是登录后的目标站请求，或重新用新版导入助手读取 Cookie。"
          };
        }

        const validatedAccount = buildAccountFromImportedUser(user, account.cookie);
        if (!validatedAccount) {
          return {
            ok: false,
            message: "Cookie 已读到，但无法解析账号信息，请复制登录后的 /api/user/self 请求再导入。"
          };
        }
        validatedAccounts.push(validatedAccount);
        continue;
      }

      const cleanToken = String(account.token || "").replace(/^Bearer\s+/i, "").trim();
      if (/^sk-[A-Za-z0-9_-]+/i.test(cleanToken)) {
        return {
          ok: false,
          message:
            "sk- 开头的是模型 API Key，不是网页登录态。已拒绝保存，LinuxDo 登录请导入目标站 Cookie 或浏览器 Copy as cURL。"
        };
      }

      const user = await fetchImportedTokenUser(providerId, cleanToken, controller.signal);
      if (!user) {
        return {
          ok: false,
          message:
            "扩展读取到的 token 服务器端不可用，已拒绝保存。请在目标站页面重新打开新版导入助手，必须读到 Cookie；否则请用 Network 复制 /api/user/self 的 cURL 导入。"
        };
      }

      const validatedAccount = buildTokenAccountFromImportedUser(user, cleanToken, account);
      if (!validatedAccount) {
        return {
          ok: false,
          message: "token 已验证，但无法解析账号信息，请改用 Copy as cURL 导入。"
        };
      }
      validatedAccounts.push(validatedAccount);
    }
  } finally {
    clearTimeout(timer);
  }

  return {
    ok: true,
    accounts: validatedAccounts
  };
}

router.use(requireAuth);

function getRequestProviderId(req) {
  const rawProvider =
    typeof req.query.provider === "string"
      ? req.query.provider
      : typeof req.body?.provider === "string"
        ? req.body.provider
        : "muyuan";
  return normalizeProviderId(rawProvider);
}

router.get("/providers", (_req, res) => {
  ok(res, getQuotaProviders());
});

router.get("/", async (req, res, next) => {
  try {
    const providerId = getRequestProviderId(req);
    const selectedUsername =
      typeof req.query.selected === "string" && req.query.selected.trim()
        ? req.query.selected.trim()
        : null;

    const dashboard = await getDashboard({
      providerId,
      force: req.query.force === "1",
      selectedUsername
    });

    ok(res, dashboard);
  } catch (error) {
    next(error);
  }
});

router.post("/accounts/:username/checkin", async (req, res, next) => {
  try {
    const providerId = getRequestProviderId(req);
    const username = decodeURIComponent(req.params.username);
    const account = loadAccounts(getProviderConfig(providerId).accountsFile).find(
      (item) => item.username === username
    );

    if (!account) {
      res.status(404).json({
        success: false,
        message: "账号不存在，请检查 accounts.txt",
        data: null
      });
      return;
    }

    const result = await checkinAccount(account, { providerId });
    ok(res, result, result.message || "签到完成");
  } catch (error) {
    if (isRateLimitError(error)) {
      res.status(429).json({
        success: false,
        message: "站点限流，请稍后重试",
        data: null
      });
      return;
    }

    next(error);
  }
});

router.delete("/accounts/:username", (req, res, next) => {
  try {
    const providerId = getRequestProviderId(req);
    const username = decodeURIComponent(req.params.username);
    const accountFile = getProviderConfig(providerId).accountsFile;
    const existingAccounts = loadAccounts(accountFile);
    const nextAccounts = existingAccounts.filter((account) => account.username !== username);

    if (nextAccounts.length === existingAccounts.length) {
      res.status(404).json({
        success: false,
        message: "账号不存在，请检查当前站点账号文件",
        data: null
      });
      return;
    }

    const backupFile = backupAccountFile(accountFile);
    const result = saveAccounts(nextAccounts, accountFile);
    clearDashboardCache({ providerId });

    ok(
      res,
      {
        accountFile: result.accountFile,
        backupFile,
        count: result.count,
        previousCount: existingAccounts.length,
        deletedUsername: username,
        usernames: result.accounts.map((account) => account.username)
      },
      `已删除账号 ${username}，当前共 ${result.count} 个账号`
    );
  } catch (error) {
    next(error);
  }
});

router.post("/checkin-all", async (req, res, next) => {
  try {
    const providerId = getRequestProviderId(req);
    const accounts = loadAccounts(getProviderConfig(providerId).accountsFile);
    if (!accounts.length) {
      sendEmptyAccounts(res);
      return;
    }

    const scope = req.body?.scope === "failed" ? "failed" : "all";
    const result = await startOrResumeCheckinQueue(scope, { providerId });
    ok(res, result, result.message);
  } catch (error) {
    if (isRateLimitError(error)) {
      res.status(429).json({
        success: false,
        message: "站点限流，请稍后重试",
        data: null
      });
      return;
    }

    next(error);
  }
});

router.post("/accounts/import", async (req, res, next) => {
  try {
    const providerId = getRequestProviderId(req);
    const content = typeof req.body?.content === "string" ? req.body.content : "";
    const format = req.body?.format === "json" || req.body?.format === "txt" ? req.body.format : "auto";
    const curlImport = await parseCurlAccountContent(providerId, content);
    const parsedAccounts = curlImport?.account
      ? [curlImport.account]
      : parseAccountsContent(content, format);

    if (!parsedAccounts.length) {
      if (curlImport?.cookie) {
        res.status(422).json({
          success: false,
          message:
            "已读取到 cURL 里的 cookie，但无法读取账号信息。请确认复制的是登录后的 MUYUAN 请求，建议复制 Network 里的 /api/user/self 请求。",
          data: null
        });
        return;
      }

      res.status(400).json({
        success: false,
        message: "未解析到有效账号，请检查 txt/json/cURL 内容格式",
        data: null
      });
      return;
    }

    const validation = await validateImportedSessionAccounts(providerId, parsedAccounts);
    if (!validation.ok) {
      res.status(422).json({
        success: false,
        message: validation.message,
        data: null
      });
      return;
    }
    const incomingAccounts = validation.accounts;

    const accountFile = getProviderConfig(providerId).accountsFile;
    const existingAccounts = loadAccounts(accountFile);
    const accounts = mergeAccounts(existingAccounts, incomingAccounts);
    const backupFile = backupAccountFile(accountFile);
    const result = saveAccounts(accounts, accountFile);
    clearDashboardCache({ providerId });

    ok(
      res,
      {
        accountFile: result.accountFile,
        backupFile,
        count: result.count,
        importedCount: incomingAccounts.length,
        previousCount: existingAccounts.length,
        mode: "merge",
        importSource: curlImport?.account ? "curl" : "content",
        usernames: result.accounts.map((account) => account.username)
      },
      `已合并导入 ${incomingAccounts.length} 个账号，当前共 ${result.count} 个账号`
    );
  } catch (error) {
    if (error instanceof SyntaxError) {
      res.status(400).json({
        success: false,
        message: "JSON 格式错误，请检查导入文件内容",
        data: null
      });
      return;
    }

    next(error);
  }
});

export default router;
