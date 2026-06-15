import crypto from "node:crypto";
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
const IMPORT_HELPER_TTL_MS = 10 * 60 * 1000;
const importHelperSessions = new Map();

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

function cleanupImportHelperSessions() {
  const now = Date.now();
  for (const [token, session] of importHelperSessions.entries()) {
    if (!session || session.expiresAt <= now) {
      importHelperSessions.delete(token);
    }
  }
}

function createImportHelperSession(providerId) {
  cleanupImportHelperSessions();
  const token = crypto.randomBytes(24).toString("base64url");
  const session = {
    providerId,
    expiresAt: Date.now() + IMPORT_HELPER_TTL_MS,
    createdAt: Date.now()
  };
  importHelperSessions.set(token, session);
  return { token, ...session };
}

function getRequestOrigin(req) {
  const configuredOrigin = process.env.PUBLIC_BASE_URL || process.env.APP_PUBLIC_URL;
  if (configuredOrigin) return String(configuredOrigin).replace(/\/+$/, "");

  const forwardedProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  const proto = forwardedProto || req.protocol || "http";
  return `${proto}://${req.get("host")}`;
}

function buildProviderImportHelperScript({ endpoint, token, providerId }) {
  const source = {
    endpoint,
    token,
    provider: providerId
  };

  return `(()=>{const config=${JSON.stringify(source)};const readPath=(object,paths)=>{for(const path of paths){let current=object;for(const segment of path.split(".")){if(!current||typeof current!=="object"||!(segment in current)){current=undefined;break}current=current[segment]}if(current!=null&&current!=="")return current}return""};const tryJson=(value)=>{try{return JSON.parse(value)}catch{return null}};const unwrap=(payload)=>payload&&typeof payload==="object"&&payload.data&&typeof payload.data==="object"?payload.data:payload;const readStorage=()=>{const result={};for(const store of [localStorage,sessionStorage]){for(let index=0;index<store.length;index+=1){const key=store.key(index);const raw=store.getItem(key);if(!raw)continue;const parsed=tryJson(raw);if(parsed&&typeof parsed==="object"){result[key]=parsed}else if(/token|session|auth|user/i.test(key)){result[key]=raw}}}return result};const flattenStorage=(storage)=>Object.values(storage).find((item)=>item&&typeof item==="object"&&(item.id||item.user_id||item.userId||item.username||item.name||item.email||item.user))||{};const requestJson=async(paths)=>{for(const path of paths){try{const response=await fetch(path,{credentials:"include",headers:{Accept:"application/json"}});if(!response.ok)continue;const json=await response.json();if(json&&json.success!==false)return unwrap(json)}catch{}}return null};const run=async()=>{const storage=readStorage();const storageUser=flattenStorage(storage);const remoteUser=await requestJson(["/api/user/self","/api/user/info","/api/user"]);const source=Object.assign({},storageUser,remoteUser||{});const displayName=readPath(source,["display_name","displayName","nickname","name","username","email","user.display_name","user.displayName","user.name","user.username"]);const username=readPath(source,["username","email","name","display_name","displayName","nickname","user.username","user.email","user.name","id","user.id"])||displayName;const token=readPath(source,["token","access_token","accessToken","session.token","user.token","user.access_token","user.accessToken"]);const userId=readPath(source,["id","user_id","userId","user.id","user.user_id","user.userId"]);const cookie=document.cookie||"";const account={username:String(username||"").trim(),displayName:String(displayName||username||"").trim(),userId:String(userId||"").trim(),token:String(token||"").trim(),cookie:String(cookie||"").trim(),authType:cookie?"cookie":token?"token":"oauth",loginProvider:"web"};const response=await fetch(config.endpoint,{method:"POST",mode:"cors",headers:{"Content-Type":"application/json"},body:JSON.stringify({token:config.token,provider:config.provider,account,diagnostics:{origin:location.origin,hasDocumentCookie:Boolean(cookie),hasStorageUser:Boolean(Object.keys(storage).length),hasRemoteUser:Boolean(remoteUser)}})});const result=await response.json().catch(()=>({success:false,message:"Auto_CW 响应解析失败"}));alert(result.message||"Auto_CW 已处理网页登录态导入");};run().catch((error)=>alert("Auto_CW 自动导入失败："+(error&&error.message?error.message:error)));})();`;
}

function buildBookmarklet(script) {
  return `javascript:${encodeURIComponent(script)}`;
}

function normalizeClaimAccount(rawAccount = {}) {
  const account = {
    username: String(rawAccount.username || rawAccount.name || rawAccount.email || "").trim(),
    displayName: String(rawAccount.displayName || rawAccount.display_name || rawAccount.nickname || rawAccount.username || "").trim(),
    userId: String(rawAccount.userId || rawAccount.user_id || rawAccount.id || "").trim(),
    token: String(rawAccount.token || rawAccount.access_token || rawAccount.accessToken || "").trim().replace(/^Bearer\s+/i, ""),
    cookie: String(rawAccount.cookie || rawAccount.cookies || "").trim(),
    authType: String(rawAccount.authType || rawAccount.auth_type || "").trim(),
    loginProvider: String(rawAccount.loginProvider || rawAccount.login_provider || rawAccount.oauthProvider || "").trim(),
    expiresAt: String(rawAccount.expiresAt || rawAccount.expires_at || "").trim()
  };

  if (/^sk-[a-z0-9]/i.test(account.token)) {
    account.token = "";
  }

  return Object.fromEntries(
    Object.entries(account).filter(([, value]) => value !== "")
  );
}

function sanitizeClaimAccount(account = {}) {
  return {
    username: account.username || "",
    displayName: account.displayName || "",
    userId: account.userId || "",
    authType: account.authType || "",
    loginProvider: account.loginProvider || "",
    hasCookie: Boolean(account.cookie),
    hasToken: Boolean(account.token),
    hasPassword: Boolean(account.password)
  };
}

router.post("/accounts/import-helper/complete", (req, res, next) => {
  try {
    cleanupImportHelperSessions();
    const token = typeof req.body?.token === "string" ? req.body.token : "";
    const session = importHelperSessions.get(token);

    if (!session) {
      res.status(410).json({
        success: false,
        message: "自动导入凭证已过期，请回到 Auto_CW 重新生成",
        data: null
      });
      return;
    }

    const providerId = normalizeProviderId(
      typeof req.body?.provider === "string" ? req.body.provider : session.providerId
    );
    if (providerId !== session.providerId) {
      res.status(400).json({
        success: false,
        message: "自动导入站点不匹配，请重新生成导入助手",
        data: null
      });
      return;
    }

    const account = normalizeClaimAccount(req.body?.account);
    if (!account.username) {
      res.status(400).json({
        success: false,
        message: "已连接到 Auto_CW，但没有读取到账号名，请确认已在站点完成登录",
        data: {
          account: sanitizeClaimAccount(account)
        }
      });
      return;
    }

    if (!account.cookie && !account.token && !account.password) {
      res.status(422).json({
        success: false,
        message: "已读取账号信息，但浏览器禁止脚本读取 HttpOnly session；请从浏览器开发者工具复制完整 cookie 后导入",
        data: {
          account: sanitizeClaimAccount(account)
        }
      });
      return;
    }

    const accountFile = getProviderConfig(providerId).accountsFile;
    const existingAccounts = loadAccounts(accountFile);
    const accounts = mergeAccounts(existingAccounts, [account]);
    const backupFile = backupAccountFile(accountFile);
    const result = saveAccounts(accounts, accountFile);
    clearDashboardCache({ providerId });
    importHelperSessions.delete(token);

    ok(
      res,
      {
        accountFile: result.accountFile,
        backupFile,
        count: result.count,
        importedCount: 1,
        previousCount: existingAccounts.length,
        mode: "merge",
        usernames: result.accounts.map((item) => item.username),
        account: sanitizeClaimAccount(account)
      },
      `已自动导入账号 ${account.displayName || account.username}`
    );
  } catch (error) {
    next(error);
  }
});

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

router.post("/accounts/import-helper", (req, res, next) => {
  try {
    const providerId = getRequestProviderId(req);
    const helper = createImportHelperSession(providerId);
    const origin = getRequestOrigin(req);
    const endpoint = `${origin}/api/quota-monitor/accounts/import-helper/complete`;
    const script = buildProviderImportHelperScript({
      endpoint,
      token: helper.token,
      providerId
    });

    ok(
      res,
      {
        provider: providerId,
        endpoint,
        script,
        bookmarklet: buildBookmarklet(script),
        expiresAt: new Date(helper.expiresAt).toISOString()
      },
      "自动导入助手已生成"
    );
  } catch (error) {
    next(error);
  }
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
    const incomingAccounts = parseAccountsContent(content, format);

    if (!incomingAccounts.length) {
      res.status(400).json({
        success: false,
        message: "未解析到有效账号，请检查 txt/json 内容格式",
        data: null
      });
      return;
    }

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
