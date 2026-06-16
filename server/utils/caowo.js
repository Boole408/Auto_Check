import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import vm from "node:vm";
import axios from "axios";
import { getAccountFilePath, loadAccounts } from "./accountLoader.js";
import { getProviderConfig, getProviderList, normalizeProviderId } from "./siteProviders.js";

const DEFAULT_QUOTA_PER_UNIT = 500000;
const DEFAULT_QUOTA_UNIT_PRICE = 1;
const DEFAULT_USD_EXCHANGE_RATE = 1;
const DEFAULT_CUSTOM_CURRENCY_EXCHANGE_RATE = 1;
const DEFAULT_CURRENCY_SYMBOL = "¥";
const DEFAULT_DASHBOARD_CACHE_TTL = 10_000;
const DEFAULT_SESSION_TTL = 6 * 60 * 60 * 1000;
const DEFAULT_IMPORTED_COOKIE_SESSION_TTL = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_RATE_LIMIT_COOLDOWN = 180_000;
const DEFAULT_USAGE_SYNC_DELAY = 4_000;
const DEFAULT_TIMEOUT = 15_000;
const DEFAULT_APP_TIMEZONE = "Asia/Shanghai";
const DEFAULT_AUTO_CHECKIN_TIME = "00:01";
const DEFAULT_AUTO_CHECKIN_RETRY_MINUTES = 10;
const AUTO_CHECKIN_HEARTBEAT_MS = 30_000;
const TREND_WINDOW_DAYS = 7;
const USAGE_LOG_PAGE_SIZE = 100;
const MAX_USAGE_LOG_PAGES = 100;

const CHECKIN_INITIAL_DELAY = 2_500;
const CHECKIN_SUCCESS_STEP = 250;
const CHECKIN_FAILURE_STEP = 1_000;
const CHECKIN_MIN_DELAY = 1_500;
const CHECKIN_MAX_DELAY = 10_000;
const CHECKIN_STATUS_SYNC_THROTTLE_MS = 60_000;
const CHECKIN_STATUS_SYNC_DELAY_MS = 2_000;

const CHECKIN_STATUSES = new Set(["checked", "unchecked", "failed", "unknown"]);
const TODAY_USED_STATUSES = new Set(["exact", "stale", "pending", "unavailable"]);

function createCaowoRuntime(provider) {
const baseURL = provider.baseUrl;
const client = axios.create({
  baseURL,
  timeout: Number.isFinite(provider.timeoutMs) ? provider.timeoutMs : DEFAULT_TIMEOUT,
  headers: {
    Accept: "application/json",
    "Content-Type": "application/json",
    "User-Agent": "AutoCheck/1.0"
  },
  validateStatus: (status) => status < 500
});

const sessionCache = new Map();
const accountStateCache = new Map();
let dashboardCache = null;
let dashboardInFlight = null;
let checkinStatusSyncInFlight = null;
let lastCheckinStatusSyncAt = 0;
let siteRates = {
  quotaPerUnit: DEFAULT_QUOTA_PER_UNIT,
  quotaUnitPrice: DEFAULT_QUOTA_UNIT_PRICE,
  usdExchangeRate: DEFAULT_USD_EXCHANGE_RATE,
  customCurrencyExchangeRate: DEFAULT_CUSTOM_CURRENCY_EXCHANGE_RATE,
  quotaDisplayType: "USD",
  currencySymbol: DEFAULT_CURRENCY_SYMBOL
};
let siteRatesExpiresAt = 0;
let rateLimitUntil = 0;
let wafChallengeCookie = "";
let wafChallengeCookieExpiresAt = 0;

const checkinQueue = createCheckinQueueState();
const usageSyncQueue = createUsageSyncQueueState();
const dashboardAlertsState = createDashboardAlertsState();
const autoCheckinScheduler = createAutoCheckinSchedulerState();

installWafChallengeInterceptors();

function createQueueProgress() {
  return {
    total: 0,
    completed: 0,
    pending: 0,
    failed: 0,
    skipped: 0
  };
}

function createCheckinQueueState() {
  return {
    status: "idle",
    scope: "all",
    items: [],
    currentUsername: null,
    cooldownUntil: null,
    message: "等待开始",
    updatedAt: new Date().toISOString(),
    delayMs: getCheckinInitialDelayMs(),
    resumeTimer: null,
    running: false,
    autoResume: false,
    lastFailedUsernames: new Set()
  };
}

function createUsageSyncQueueState() {
  return {
    status: "idle",
    order: [],
    currentUsername: null,
    cooldownUntil: null,
    message: "等待同步",
    updatedAt: new Date().toISOString(),
    running: false,
    resumeTimer: null,
    selectedUsername: null,
    priorityUsernames: new Set(),
    syncedUsernames: new Set(),
    failedUsernames: new Set()
  };
}

function createDashboardAlertsState() {
  return {
    rateLimit: {
      streak: 0,
      updatedAt: null
    },
    authFailed: {
      usernames: new Set(),
      updatedAt: null
    },
    syncTimeout: {
      usernames: new Set(),
      updatedAt: null
    }
  };
}

function createAutoCheckinStore() {
  return {
    lastTriggeredDay: null,
    lastTriggeredAt: null,
    lastAttemptAt: null,
    lastErrorMessage: null,
    lastCompletedDay: null,
    lastCompletedAt: null,
    activeDay: null
  };
}

function createAutoCheckinSchedulerState() {
  return {
    timer: null,
    running: false,
    store: createAutoCheckinStore()
  };
}

function rememberAlertUsername(collection, username) {
  if (!username) return;
  collection.add(username);
}

function forgetAlertUsername(collection, username) {
  if (!username) return;
  collection.delete(username);
}

function isTimeoutError(error) {
  return (
    error?.code === "ECONNABORTED" ||
    error?.status === 408 ||
    error?.response?.status === 408 ||
    /timeout|timed out|超时/i.test(error?.message || "")
  );
}

function registerRateLimitAlert() {
  dashboardAlertsState.rateLimit.streak += 1;
  dashboardAlertsState.rateLimit.updatedAt = nowIso();
}

function clearRateLimitAlert() {
  dashboardAlertsState.rateLimit.streak = 0;
  dashboardAlertsState.rateLimit.updatedAt = null;
}

function registerAuthFailedAlert(username) {
  rememberAlertUsername(dashboardAlertsState.authFailed.usernames, username);
  dashboardAlertsState.authFailed.updatedAt = nowIso();
}

function clearAuthFailedAlert(username) {
  forgetAlertUsername(dashboardAlertsState.authFailed.usernames, username);
  if (!dashboardAlertsState.authFailed.usernames.size) {
    dashboardAlertsState.authFailed.updatedAt = null;
  }
}

function registerSyncTimeoutAlert(username) {
  rememberAlertUsername(dashboardAlertsState.syncTimeout.usernames, username);
  dashboardAlertsState.syncTimeout.updatedAt = nowIso();
}

function clearSyncTimeoutAlert(username) {
  forgetAlertUsername(dashboardAlertsState.syncTimeout.usernames, username);
  if (!dashboardAlertsState.syncTimeout.usernames.size) {
    dashboardAlertsState.syncTimeout.updatedAt = null;
  }
}

function debugLog(message, payload = {}) {
  if (process.env.CAOWO_DEBUG === "1" || process.env[`${provider.id.toUpperCase()}_DEBUG`] === "1") {
    console.warn(`[${provider.id}-debug] ${message}`, JSON.stringify(payload));
  }
}

function normalizeCookiePair(cookieText = "") {
  return String(cookieText || "").split(";")[0].trim();
}

function mergeCookieHeader(existingCookie = "", nextCookie = "") {
  const pairs = new Map();

  for (const source of [existingCookie, nextCookie]) {
    for (const entry of String(source || "").split(";")) {
      const normalized = entry.trim();
      const separatorIndex = normalized.indexOf("=");
      if (separatorIndex <= 0) continue;
      pairs.set(normalized.slice(0, separatorIndex), normalized.slice(separatorIndex + 1));
    }
  }

  return Array.from(pairs, ([name, value]) => `${name}=${value}`).join("; ");
}

function readHeader(headers, name) {
  if (!headers) return "";
  if (typeof headers.get === "function") return headers.get(name) || headers.get(name.toLowerCase()) || "";
  return headers[name] || headers[name.toLowerCase()] || "";
}

function writeHeader(headers, name, value) {
  if (!headers || !value) return;
  if (typeof headers.set === "function") {
    headers.set(name, value);
    return;
  }
  headers[name] = value;
}

function attachCookieToRequestConfig(config, cookie) {
  const cookiePair = normalizeCookiePair(cookie);
  if (!cookiePair) return config;

  config.headers = config.headers || {};
  const existingCookie = readHeader(config.headers, "Cookie");
  writeHeader(config.headers, "Cookie", mergeCookieHeader(existingCookie, cookiePair));
  return config;
}

function getActiveWafChallengeCookie() {
  if (!wafChallengeCookie || wafChallengeCookieExpiresAt <= Date.now()) return "";
  return wafChallengeCookie;
}

function isWafChallengePayload(payload) {
  return (
    typeof payload === "string" &&
    payload.includes("acw_sc__v2") &&
    payload.includes("var arg1=")
  );
}

function parseCookieExpiresAt(cookieText = "") {
  const maxAgeMatch = String(cookieText).match(/(?:^|;)\s*max-age=(\d+)/i);
  if (maxAgeMatch) {
    return Date.now() + Number(maxAgeMatch[1]) * 1000;
  }

  const expiresMatch = String(cookieText).match(/(?:^|;)\s*expires=([^;]+)/i);
  if (expiresMatch) {
    const expiresAt = Date.parse(expiresMatch[1]);
    if (Number.isFinite(expiresAt)) return expiresAt;
  }

  return Date.now() + 55 * 60 * 1000;
}

function solveWafChallengeCookie(html = "") {
  const script = String(html).match(/<script[^>]*>([\s\S]*?)<\/script>/i)?.[1];
  if (!script) return "";

  let cookie = "";
  const document = {
    get cookie() {
      return cookie;
    },
    set cookie(value) {
      cookie = value;
    },
    location: {
      reload() {
        throw new Error("WAF_RELOAD");
      }
    }
  };
  const context = {
    document,
    window: {},
    Date,
    RegExp,
    parseInt,
    Boolean,
    String,
    Math,
    decodeURIComponent,
    console: {
      log() {},
      info() {},
      warn() {},
      error() {},
      debug() {}
    }
  };
  context.window = context;

  try {
    vm.runInNewContext(script, context, { timeout: 2_000 });
  } catch (error) {
    if (error?.message !== "WAF_RELOAD") {
      debugLog("waf-challenge-solve-failed", { message: error?.message });
      return "";
    }
  }

  return cookie;
}

function refreshWafChallengeCookie(payload) {
  const solvedCookie = solveWafChallengeCookie(payload);
  const cookiePair = normalizeCookiePair(solvedCookie);
  if (!cookiePair) return "";

  wafChallengeCookie = cookiePair;
  wafChallengeCookieExpiresAt = parseCookieExpiresAt(solvedCookie);
  debugLog("waf-challenge-cookie-refreshed", { expiresAt: new Date(wafChallengeCookieExpiresAt).toISOString() });
  return cookiePair;
}

function installWafChallengeInterceptors() {
  client.interceptors.request.use((config) => {
    const cookie = getActiveWafChallengeCookie();
    return cookie ? attachCookieToRequestConfig(config, cookie) : config;
  });

  client.interceptors.response.use(async (response) => {
    if (!isWafChallengePayload(response.data) || response.config?.__wafChallengeRetried) {
      return response;
    }

    const cookie = refreshWafChallengeCookie(response.data);
    if (!cookie) return response;

    const retryConfig = {
      ...response.config,
      __wafChallengeRetried: true,
      headers: response.config.headers
    };
    attachCookieToRequestConfig(retryConfig, cookie);
    return client.request(retryConfig);
  });
}

function getNumberEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function getBooleanEnv(name, fallback) {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  return !["0", "false", "no", "off"].includes(String(raw).trim().toLowerCase());
}

function isValidTimeZone(timeZone) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format();
    return true;
  } catch {
    return false;
  }
}

function normalizeAutoCheckinTime(value) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(value || "").trim());
  return match ? `${match[1]}:${match[2]}` : DEFAULT_AUTO_CHECKIN_TIME;
}

function getAppTimeZone() {
  const configured = provider.autoCheckinTz || DEFAULT_APP_TIMEZONE;
  return isValidTimeZone(configured) ? configured : DEFAULT_APP_TIMEZONE;
}

function getAutoCheckinConfig() {
  return {
    enabled: Boolean(provider.autoCheckinEnabled),
    time: normalizeAutoCheckinTime(provider.autoCheckinTime),
    timezone: getAppTimeZone(),
    catchUpEnabled: Boolean(provider.autoCheckinCatchUp),
    retryMinutes: Math.max(1, Number(provider.autoCheckinRetryMinutes || DEFAULT_AUTO_CHECKIN_RETRY_MINUTES))
  };
}

function getDashboardCacheTtl() {
  return Number.isFinite(provider.cacheTtlMs) ? provider.cacheTtlMs : DEFAULT_DASHBOARD_CACHE_TTL;
}

function getRateLimitCooldownMs() {
  return Number.isFinite(provider.rateLimitCooldownMs)
    ? provider.rateLimitCooldownMs
    : DEFAULT_RATE_LIMIT_COOLDOWN;
}

function getUsageSyncDelayMs() {
  return Number.isFinite(provider.usageSyncDelayMs)
    ? provider.usageSyncDelayMs
    : DEFAULT_USAGE_SYNC_DELAY;
}

function getCheckinInitialDelayMs() {
  return Math.max(
    0,
    Number.isFinite(provider.checkinInitialDelayMs)
      ? provider.checkinInitialDelayMs
      : CHECKIN_INITIAL_DELAY
  );
}

function getCheckinMinDelayMs() {
  return Math.max(
    0,
    Number.isFinite(provider.checkinMinDelayMs) ? provider.checkinMinDelayMs : CHECKIN_MIN_DELAY
  );
}

function getCheckinMaxDelayMs() {
  return Math.max(
    getCheckinMinDelayMs(),
    Number.isFinite(provider.checkinMaxDelayMs) ? provider.checkinMaxDelayMs : CHECKIN_MAX_DELAY
  );
}

function getCheckinSuccessStepMs() {
  return Math.max(
    0,
    Number.isFinite(provider.checkinSuccessStepMs)
      ? provider.checkinSuccessStepMs
      : CHECKIN_SUCCESS_STEP
  );
}

function getCheckinFailureStepMs() {
  return Math.max(
    0,
    Number.isFinite(provider.checkinFailureStepMs)
      ? provider.checkinFailureStepMs
      : CHECKIN_FAILURE_STEP
  );
}

function getCheckinDelayJitterMs() {
  return Math.max(
    0,
    Number.isFinite(provider.checkinDelayJitterMs) ? provider.checkinDelayJitterMs : 0
  );
}

function withCheckinDelayJitter(delayMs) {
  const jitterMs = getCheckinDelayJitterMs();
  if (!jitterMs) return delayMs;
  return delayMs + Math.floor(Math.random() * (jitterMs + 1));
}

function getSessionStorePath() {
  return path.resolve(process.cwd(), ".cache", `${provider.id}-sessions.json`);
}

function getAutoCheckinStorePath() {
  return path.resolve(process.cwd(), ".cache", `${provider.id}-auto-checkin.json`);
}

function getApiKeyStorePath() {
  return path.resolve(process.cwd(), ".cache", `${provider.id}-api-keys.json`);
}

const zonedFormatterCache = new Map();
const zonedOffsetFormatterCache = new Map();

function getZonedDateFormatter(timeZone) {
  if (!zonedFormatterCache.has(timeZone)) {
    zonedFormatterCache.set(
      timeZone,
      new Intl.DateTimeFormat("en-CA", {
        timeZone,
        hour12: false,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
      })
    );
  }
  return zonedFormatterCache.get(timeZone);
}

function getZonedOffsetFormatter(timeZone) {
  if (!zonedOffsetFormatterCache.has(timeZone)) {
    zonedOffsetFormatterCache.set(
      timeZone,
      new Intl.DateTimeFormat("en-US", {
        timeZone,
        timeZoneName: "shortOffset",
        hour: "2-digit"
      })
    );
  }
  return zonedOffsetFormatterCache.get(timeZone);
}

function getZonedDateParts(date = new Date(), timeZone = getAppTimeZone()) {
  const parts = {};
  for (const part of getZonedDateFormatter(timeZone).formatToParts(date)) {
    if (part.type === "year") parts.year = Number(part.value);
    if (part.type === "month") parts.month = Number(part.value);
    if (part.type === "day") parts.day = Number(part.value);
    if (part.type === "hour") parts.hour = Number(part.value);
    if (part.type === "minute") parts.minute = Number(part.value);
    if (part.type === "second") parts.second = Number(part.value);
  }
  return {
    year: parts.year || 0,
    month: parts.month || 1,
    day: parts.day || 1,
    hour: parts.hour || 0,
    minute: parts.minute || 0,
    second: parts.second || 0
  };
}

function getTimeZoneOffsetMinutes(date = new Date(), timeZone = getAppTimeZone()) {
  const timeZoneName = getZonedOffsetFormatter(timeZone)
    .formatToParts(date)
    .find((part) => part.type === "timeZoneName")?.value;

  if (!timeZoneName || timeZoneName === "GMT") return 0;
  const match = /^GMT([+-])(\d{1,2})(?::?(\d{2}))?$/.exec(timeZoneName);
  if (!match) return 0;
  const sign = match[1] === "-" ? -1 : 1;
  const hours = Number(match[2] || 0);
  const minutes = Number(match[3] || 0);
  return sign * (hours * 60 + minutes);
}

function zonedDateTimeToDate(parts, timeZone = getAppTimeZone()) {
  const naiveUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour || 0,
    parts.minute || 0,
    parts.second || 0,
    parts.millisecond || 0
  );
  let offset = getTimeZoneOffsetMinutes(new Date(naiveUtc), timeZone);
  let candidate = new Date(naiveUtc - offset * 60 * 1000);
  const correctedOffset = getTimeZoneOffsetMinutes(candidate, timeZone);
  if (correctedOffset !== offset) {
    offset = correctedOffset;
    candidate = new Date(naiveUtc - offset * 60 * 1000);
  }
  return candidate;
}

function formatDayKey(parts) {
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(
    2,
    "0"
  )}`;
}

function formatClock(parts) {
  return `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;
}

function getDayKeyForDate(date = new Date(), timeZone = getAppTimeZone()) {
  return formatDayKey(getZonedDateParts(date, timeZone));
}

function getMonthKeyForDate(date = new Date(), timeZone = getAppTimeZone()) {
  const parts = getZonedDateParts(date, timeZone);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}`;
}

function getTargetTimeParts(time = DEFAULT_AUTO_CHECKIN_TIME) {
  const [hour, minute] = normalizeAutoCheckinTime(time).split(":").map(Number);
  return { hour, minute };
}

function getOffsetDayParts(parts, offset, timeZone = getAppTimeZone()) {
  const anchor = zonedDateTimeToDate(
    {
      year: parts.year,
      month: parts.month,
      day: parts.day,
      hour: 12,
      minute: 0,
      second: 0
    },
    timeZone
  );
  anchor.setUTCDate(anchor.getUTCDate() + offset);
  return getZonedDateParts(anchor, timeZone);
}

function getNextDayParts(parts, timeZone = getAppTimeZone()) {
  return getOffsetDayParts(parts, 1, timeZone);
}

function getScheduledDateForDay(parts, time = DEFAULT_AUTO_CHECKIN_TIME, timeZone = getAppTimeZone()) {
  const target = getTargetTimeParts(time);
  return zonedDateTimeToDate(
    {
      year: parts.year,
      month: parts.month,
      day: parts.day,
      hour: target.hour,
      minute: target.minute,
      second: 0
    },
    timeZone
  );
}

function nowIso() {
  return new Date().toISOString();
}

function currentDayKey() {
  return getDayKeyForDate(new Date(), getAppTimeZone());
}

function currentMonthKey() {
  return getMonthKeyForDate(new Date(), getAppTimeZone());
}

function todayRangeSeconds() {
  const timeZone = getAppTimeZone();
  const nowParts = getZonedDateParts(new Date(), timeZone);
  const start = getScheduledDateForDay(nowParts, "00:00", timeZone);
  const end = zonedDateTimeToDate(
    {
      year: nowParts.year,
      month: nowParts.month,
      day: nowParts.day,
      hour: 23,
      minute: 59,
      second: 59,
      millisecond: 999
    },
    timeZone
  );
  return {
    start: Math.floor(start.getTime() / 1000),
    end: Math.floor(end.getTime() / 1000)
  };
}

function getRecentDayKeys(windowDays = TREND_WINDOW_DAYS, timeZone = getAppTimeZone()) {
  const todayParts = getZonedDateParts(new Date(), timeZone);
  return Array.from({ length: windowDays }, (_, index) =>
    formatDayKey(getOffsetDayParts(todayParts, index - (windowDays - 1), timeZone))
  );
}

function getRecentMonthKeys(windowDays = TREND_WINDOW_DAYS, timeZone = getAppTimeZone()) {
  const todayParts = getZonedDateParts(new Date(), timeZone);
  const monthKeys = new Set();

  for (let index = 0; index < windowDays; index += 1) {
    const dateParts = getOffsetDayParts(todayParts, index - (windowDays - 1), timeZone);
    monthKeys.add(`${dateParts.year}-${String(dateParts.month).padStart(2, "0")}`);
  }

  return Array.from(monthKeys);
}

function passwordHash(password) {
  return crypto.createHash("sha256").update(String(password)).digest("hex");
}

function accountCredentialFingerprint(account) {
  const material = [
    account.password || "",
    account.token || "",
    account.cookie || "",
    account.userId || "",
    account.expiresAt || "",
    account.authType || "",
    account.loginProvider || ""
  ].join(":");
  return passwordHash(material || account.username);
}

function accountCacheKey(account) {
  return `${account.username}:${accountCredentialFingerprint(account)}`;
}

function sessionCacheKey(account) {
  return `${account.username}:${accountCredentialFingerprint(account)}`;
}

function loadAccountsWithKeys() {
  return loadAccounts(provider.accountsFile).map((account) => ({
    ...account,
    key: accountCacheKey(account)
  }));
}

function buildAccountKeySet(accounts = []) {
  return new Set(accounts.map((account) => account.key || accountCacheKey(account)));
}

function pruneRuntimeCaches(accounts = []) {
  const activeKeys = buildAccountKeySet(accounts);

  for (const key of sessionCache.keys()) {
    if (!activeKeys.has(key)) {
      sessionCache.delete(key);
    }
  }

  for (const key of accountStateCache.keys()) {
    if (!activeKeys.has(key)) {
      accountStateCache.delete(key);
    }
  }
}

function hasSessionAuth(session) {
  return Boolean(session?.token || session?.cookie);
}

function pruneSessionStore(store = {}, accounts = loadAccountsWithKeys()) {
  const activeKeys = buildAccountKeySet(accounts);
  const nextStore = {};

  for (const key of activeKeys) {
    const session = store?.[key];
    if (
      !session ||
      !hasSessionAuth(session) ||
      session.expiresAt <= Date.now() ||
      !isValidProviderUserId(session.userId)
    ) {
      continue;
    }
    nextStore[key] = session;
  }

  return nextStore;
}

function syncSessionStoreFile(accounts = loadAccountsWithKeys()) {
  try {
    const filePath = getSessionStorePath();
    if (!fs.existsSync(filePath)) return;
    const rawStore = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const nextStore = pruneSessionStore(rawStore, accounts);
    if (JSON.stringify(rawStore) !== JSON.stringify(nextStore)) {
      fs.writeFileSync(filePath, JSON.stringify(nextStore), "utf8");
    }
  } catch {
    // Session persistence is only an optimization.
  }
}

function pruneApiKeyStore(store = {}, accounts = loadAccountsWithKeys()) {
  const activeKeys = buildAccountKeySet(accounts);
  const nextStore = {};

  for (const key of activeKeys) {
    const record = store?.[key];
    if (!record?.apiKey) continue;
    nextStore[key] = {
      apiKey: String(record.apiKey),
      updatedAt: record.updatedAt || nowIso()
    };
  }

  return nextStore;
}

function syncApiKeyStoreFile(accounts = loadAccountsWithKeys()) {
  try {
    const filePath = getApiKeyStorePath();
    if (!fs.existsSync(filePath)) return;
    const rawStore = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const nextStore = pruneApiKeyStore(rawStore, accounts);
    if (JSON.stringify(rawStore) !== JSON.stringify(nextStore)) {
      fs.writeFileSync(filePath, JSON.stringify(nextStore), "utf8");
    }
  } catch {
    // API key persistence is only an optimization.
  }
}

function readApiKeyStore() {
  try {
    const filePath = getApiKeyStorePath();
    if (!fs.existsSync(filePath)) return {};
    const rawStore = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const nextStore = pruneApiKeyStore(rawStore);
    if (JSON.stringify(rawStore) !== JSON.stringify(nextStore)) {
      writeApiKeyStore(nextStore);
    }
    return nextStore;
  } catch {
    return {};
  }
}

function writeApiKeyStore(store) {
  try {
    const filePath = getApiKeyStorePath();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(pruneApiKeyStore(store)), "utf8");
  } catch {
    // API key persistence is only an optimization.
  }
}

function readPersistedApiKey(account) {
  const key = account.key || accountCacheKey(account);
  return readApiKeyStore()[key] || null;
}

function writePersistedApiKey(account, apiKey, updatedAt = nowIso()) {
  if (!account || !apiKey || isMaskedApiKey(apiKey)) return;
  const key = account.key || accountCacheKey(account);
  const store = readApiKeyStore();
  store[key] = {
    apiKey: String(apiKey),
    updatedAt
  };
  writeApiKeyStore(store);
}

function invalidateSession(account) {
  const key = sessionCacheKey(account);
  sessionCache.delete(key);

  const sessionStore = readSessionStore();
  if (sessionStore[key]) {
    delete sessionStore[key];
    writeSessionStore(sessionStore);
  }
}

function readSessionStore() {
  try {
    const filePath = getSessionStorePath();
    if (!fs.existsSync(filePath)) return {};
    const rawStore = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const nextStore = pruneSessionStore(rawStore);
    if (JSON.stringify(rawStore) !== JSON.stringify(nextStore)) {
      writeSessionStore(nextStore);
    }
    return nextStore;
  } catch {
    return {};
  }
}

function writeSessionStore(store) {
  try {
    const filePath = getSessionStorePath();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(pruneSessionStore(store)), "utf8");
  } catch {
    // Session persistence is only an optimization.
  }
}

function readAutoCheckinStore() {
  try {
    const filePath = getAutoCheckinStorePath();
    if (!fs.existsSync(filePath)) return createAutoCheckinStore();
    return {
      ...createAutoCheckinStore(),
      ...JSON.parse(fs.readFileSync(filePath, "utf8"))
    };
  } catch {
    return createAutoCheckinStore();
  }
}

function writeAutoCheckinStore(store) {
  try {
    const filePath = getAutoCheckinStorePath();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(store), "utf8");
  } catch {
    // Auto check-in persistence is best effort.
  }
}

function updateAutoCheckinStore(patch) {
  autoCheckinScheduler.store = {
    ...createAutoCheckinStore(),
    ...autoCheckinScheduler.store,
    ...patch
  };
  writeAutoCheckinStore(autoCheckinScheduler.store);
  clearDashboardCache();
  return autoCheckinScheduler.store;
}

function isSameZonedDay(left, right, timeZone = getAppTimeZone()) {
  if (!left || !right) return false;
  return getDayKeyForDate(left, timeZone) === getDayKeyForDate(right, timeZone);
}

function isAtOrAfterScheduledTime(parts, time = DEFAULT_AUTO_CHECKIN_TIME) {
  return formatClock(parts) >= normalizeAutoCheckinTime(time);
}

function getNextAutoCheckinRunAt(
  config = getAutoCheckinConfig(),
  store = autoCheckinScheduler.store,
  now = new Date()
) {
  if (!config.enabled) return null;

  const todayParts = getZonedDateParts(now, config.timezone);
  const todayKey = formatDayKey(todayParts);
  const scheduledToday = getScheduledDateForDay(todayParts, config.time, config.timezone);

  if (isAutoCheckinCompletedForDay(todayKey)) {
    return getScheduledDateForDay(
      getNextDayParts(todayParts, config.timezone),
      config.time,
      config.timezone
    ).toISOString();
  }

  const lastAttemptAt = store.lastAttemptAt ? new Date(store.lastAttemptAt) : null;
  const shouldRetryToday =
    Boolean(store.lastErrorMessage) &&
    lastAttemptAt &&
    isSameZonedDay(lastAttemptAt, now, config.timezone);

  if (shouldRetryToday) {
    const retryAt = new Date(lastAttemptAt.getTime() + config.retryMinutes * 60 * 1000);
    if (isAtOrAfterScheduledTime(todayParts, config.time) && config.catchUpEnabled) {
      return new Date(Math.max(retryAt.getTime(), now.getTime())).toISOString();
    }
  }

  if (scheduledToday.getTime() > now.getTime()) {
    return scheduledToday.toISOString();
  }

  if (config.catchUpEnabled) {
    return now.toISOString();
  }

  return getScheduledDateForDay(
    getNextDayParts(todayParts, config.timezone),
    config.time,
    config.timezone
  ).toISOString();
}

function unwrap(payload) {
  if (!payload || typeof payload !== "object") return payload;
  return payload.data && typeof payload.data === "object" ? payload.data : payload;
}

function readPath(object, keys) {
  for (const key of keys) {
    const segments = key.split(".");
    let current = object;
    for (const segment of segments) {
      if (current == null || typeof current !== "object" || !(segment in current)) {
        current = undefined;
        break;
      }
      current = current[segment];
    }
    if (current !== undefined && current !== null && current !== "") return current;
  }
  return undefined;
}

function toNumber(value, fallback = 0) {
  if (value === undefined || value === null || value === "") return fallback;
  const normalized = typeof value === "string" ? value.replace(/[^\d.-]/g, "") : value;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : fallback;
}

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function isSuccessEnvelope(payload) {
  if (!payload) return true;
  if (typeof payload !== "object") return false;
  if (payload.success === false) return false;
  if (typeof payload.code === "number" && ![0, 200].includes(payload.code)) return false;
  return true;
}

function messageFrom(payload, fallback = "接口请求失败") {
  return payload?.message || payload?.msg || payload?.error || fallback;
}

function parseMaybeJson(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return fallback;
  }
}

function sanitizeUserForSession(user) {
  if (!user || typeof user !== "object") return null;
  const { password, token, access_token, accessToken, ...safeUser } = user;
  return safeUser;
}

function sanitizeDisplayName(value, fallback = "") {
  const cleanDisplayCandidate = (candidate) => {
    const normalized = String(candidate ?? "")
    .replace(/：/g, ":")
    .replace(/，/g, ",")
    .replace(/；/g, ";")
    .trim();
    return normalized
      .replace(/^(?:账号|用户名|username|user)\s*[:=]\s*/i, "")
      .replace(/\s*(?:密码|password|pass)\s*[:=].*$/i, "")
      .split(/[;,]/)[0]
      .trim()
      .replace(/^["']|["']$/g, "");
  };

  return cleanDisplayCandidate(value) || cleanDisplayCandidate(fallback);
}

function extractApiKeyFromTokenItem(item) {
  if (typeof item === "string") return item.trim();
  if (!item || typeof item !== "object") return "";
  return String(
    item.key ||
      item.api_key ||
      item.apiKey ||
      item.token ||
      item.value ||
      item.secret ||
      ""
  ).trim();
}

function isMaskedApiKey(value = "") {
  return String(value).includes("*");
}

function normalizeTokenItems(payload = {}) {
  const data = unwrap(payload) || {};
  const items = Array.isArray(data)
    ? data
    : data.items || data.tokens || data.records || data.list || data.data;
  return Array.isArray(items) ? items : [];
}

function isActiveTokenItem(item) {
  const status = readPath(item, ["status", "enabled", "active"]);
  if (status === undefined || status === null || status === "") return true;
  if (typeof status === "boolean") return status;
  return ["1", "true", "enabled", "active"].includes(String(status).toLowerCase());
}

function tokenSortValue(item) {
  return toNumber(
    readPath(item, ["created_time", "createdTime", "created_at", "createdAt", "id"]),
    0
  );
}

function pickActiveTokenItem(items = []) {
  return items
    .filter(isActiveTokenItem)
    .sort((left, right) => tokenSortValue(right) - tokenSortValue(left))[0] || null;
}

function apiKeySyncRequestOptions(session) {
  return {
    timeout: Math.min(Number(provider.timeoutMs || DEFAULT_TIMEOUT), 5_000)
  };
}

async function fetchFullTokenKey(session, tokenId) {
  if (tokenId === undefined || tokenId === null || tokenId === "") return "";

  try {
    const response = await authedPost(
      session,
      `/api/token/${encodeURIComponent(String(tokenId))}/key`,
      null,
      apiKeySyncRequestOptions(session)
    );
    if (response.status < 200 || response.status >= 300) return null;
    if (!isSuccessEnvelope(response.data)) return null;

    const apiKey = extractApiKeyFromTokenItem(unwrap(response.data));
    return apiKey && !isMaskedApiKey(apiKey) ? apiKey : "";
  } catch (error) {
    debugLog("api-key-full-fetch-failed", {
      username: session.username,
      status: error?.status || error?.response?.status,
      message: error?.message
    });
    return null;
  }
}

async function fetchAccountApiKey(session) {
  const endpoints = [
    "/api/token/?p=1&size=100",
    "/api/token/search?keyword=&token=&p=1&size=100"
  ];
  let reachedTokenEndpoint = false;

  for (const endpoint of endpoints) {
    try {
      const response = await authedGet(session, endpoint, apiKeySyncRequestOptions(session));
      if ([400, 401, 403, 404, 405, 429].includes(response.status)) continue;
      if (response.status < 200 || response.status >= 300) continue;
      if (!isSuccessEnvelope(response.data)) continue;

      reachedTokenEndpoint = true;
      const tokenItem = pickActiveTokenItem(normalizeTokenItems(response.data));
      if (!tokenItem) return "";

      const tokenId = readPath(tokenItem, ["id"]);
      const fullKey = await fetchFullTokenKey(session, tokenId);
      if (fullKey) return fullKey;

      const inlineKey = extractApiKeyFromTokenItem(tokenItem);
      if (inlineKey) return inlineKey;
      return fullKey === null ? null : "";
    } catch (error) {
      debugLog("api-key-list-fetch-failed", {
        username: session.username,
        endpoint,
        status: error?.status || error?.response?.status,
        message: error?.message
      });
    }
  }

  return reachedTokenEndpoint ? "" : null;
}

function applyAccountApiKey(state, apiKey) {
  if (apiKey === null || apiKey === undefined) return state;
  const normalizedApiKey = String(apiKey || "").trim();
  if (!normalizedApiKey) return state;
  if (isMaskedApiKey(normalizedApiKey) && state.apiKey && !isMaskedApiKey(state.apiKey)) {
    return state;
  }
  state.apiKey = normalizedApiKey;
  state.apiKeyUpdatedAt = nowIso();
  state.updatedAt = nowIso();
  return state;
}

function assertHttpOk(response, context) {
  if (response.status === 429) {
    const error = new CaowoError("站点限流，请稍后重试", 429, "RATE_LIMIT", response.data);
    enterRateLimitCooldown(error);
    throw error;
  }
  if (response.status === 401 || response.status === 403) {
    throw new CaowoError("登录已失效，请重新同步", response.status, "AUTH_FAILED", response.data);
  }
  if (response.status >= 400) {
    throw new CaowoError(
      `${context}失败：${messageFrom(response.data)}`,
      response.status,
      "HTTP_ERROR",
      response.data
    );
  }
  clearRateLimitAlert();
  return response;
}

function extractCookie(headers) {
  const setCookie = getSetCookieHeaders(headers);
  if (!setCookie.length) return "";
  return setCookie.map((item) => item.split(";")[0]).join("; ");
}

function getSetCookieHeaders(headers) {
  const setCookie = headers?.["set-cookie"];
  if (!setCookie) return [];
  return Array.isArray(setCookie) ? setCookie : [setCookie];
}

function splitCookiePairs(cookieHeader = "") {
  const pairs = new Map();
  String(cookieHeader || "")
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean)
    .forEach((item) => {
      const separatorIndex = item.indexOf("=");
      if (separatorIndex <= 0) return;
      const name = item.slice(0, separatorIndex).trim();
      const value = item.slice(separatorIndex + 1).trim();
      if (name) pairs.set(name, value);
    });
  return pairs;
}

function parseSetCookieMaxAge(setCookie = "") {
  const match = String(setCookie).match(/;\s*max-age=(-?\d+)/i);
  if (!match) return null;
  const seconds = Number(match[1]);
  return Number.isFinite(seconds) ? seconds : null;
}

function parseSetCookieExpiresAt(setCookie = "") {
  const maxAge = parseSetCookieMaxAge(setCookie);
  if (maxAge != null) return Date.now() + maxAge * 1000;

  const expiresMatch = String(setCookie).match(/;\s*expires=([^;]+)/i);
  if (!expiresMatch) return null;
  const parsed = Date.parse(expiresMatch[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function mergeResponseCookies(existingCookie = "", headers = {}) {
  const setCookieHeaders = getSetCookieHeaders(headers);
  if (!setCookieHeaders.length) {
    return {
      cookie: existingCookie || "",
      expiresAt: null,
      changed: false
    };
  }

  const pairs = splitCookiePairs(existingCookie);
  let changed = false;
  let latestExpiresAt = null;
  let expiredAuthCookie = false;

  for (const setCookie of setCookieHeaders) {
    const [cookiePair] = String(setCookie).split(";");
    const separatorIndex = cookiePair.indexOf("=");
    if (separatorIndex <= 0) continue;

    const name = cookiePair.slice(0, separatorIndex).trim();
    const value = cookiePair.slice(separatorIndex + 1).trim();
    if (!name) continue;

    const expiresAt = parseSetCookieExpiresAt(setCookie);
    if (expiresAt != null) {
      latestExpiresAt = Math.max(latestExpiresAt || 0, expiresAt);
    }

    if (expiresAt != null && expiresAt <= Date.now()) {
      if (/^(session|token)$/i.test(name)) {
        expiredAuthCookie = true;
      }
      if (pairs.delete(name)) changed = true;
      continue;
    }

    if (pairs.get(name) !== value) {
      pairs.set(name, value);
      changed = true;
    }
  }

  return {
    cookie: Array.from(pairs.entries())
      .map(([name, value]) => `${name}=${value}`)
      .join("; "),
    expiresAt: latestExpiresAt,
    expiredAuthCookie,
    changed
  };
}

function persistSessionFromResponse(session, response) {
  if (!session?.accountKey || !response?.headers) return;

  const merged = mergeResponseCookies(session.cookie, response.headers);
  if (!merged.changed && !merged.expiresAt) return;

  const nextSession = {
    ...session,
    cookie: merged.cookie || session.cookie || "",
    expiresAt: merged.expiredAuthCookie
      ? Date.now() - 1000
      : Math.max(
          Number(session.expiresAt) || 0,
          Number(merged.expiresAt) || 0,
          Date.now() + DEFAULT_SESSION_TTL
        )
  };

  Object.assign(session, nextSession);
  sessionCache.set(session.accountKey, nextSession);
  const sessionStore = readSessionStore();
  sessionStore[session.accountKey] = nextSession;
  writeSessionStore(sessionStore);
}

function sessionHeaders(session) {
  const headers = {
    "New-API-User": String(session.userId || session.username)
  };

  if (session.token) {
    const token = String(session.token).replace(/^Bearer\s+/i, "");
    headers.Authorization = `Bearer ${token}`;
    headers["New-API-Token"] = token;
  }

  if (session.cookie) {
    headers.Cookie = session.cookie;
  }

  return headers;
}

function withSessionRequestOptions(session, options = {}) {
  const { headers = {}, ...rest } = options || {};
  return {
    ...rest,
    headers: {
      ...sessionHeaders(session),
      ...headers
    }
  };
}

async function authedGet(session, url, options = {}) {
  const response = await client.get(url, withSessionRequestOptions(session, options));
  persistSessionFromResponse(session, response);
  return response;
}

async function authedPost(session, url, data = null, options = {}) {
  const response = await client.post(url, data, withSessionRequestOptions(session, options));
  persistSessionFromResponse(session, response);
  return response;
}

function enterRateLimitCooldown(error) {
  registerRateLimitAlert();
  rateLimitUntil = Date.now() + getRateLimitCooldownMs();
  checkinQueue.cooldownUntil = new Date(rateLimitUntil).toISOString();
  usageSyncQueue.cooldownUntil = new Date(rateLimitUntil).toISOString();
  debugLog("rate-limit-cooldown", {
    until: checkinQueue.cooldownUntil,
    message: error?.message
  });
}

function isCoolingDown() {
  return Date.now() < rateLimitUntil;
}

function getCooldownUntilIso() {
  return rateLimitUntil ? new Date(rateLimitUntil).toISOString() : null;
}

function cooldownMessage() {
  const seconds = Math.max(1, Math.ceil((rateLimitUntil - Date.now()) / 1000));
  return `站点限流冷却中，约 ${seconds} 秒后再重试`;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clearDashboardCache() {
  dashboardCache = null;
  dashboardInFlight = null;
}

function isRateLimitError(error) {
  return (
    error?.status === 429 ||
    error?.response?.status === 429 ||
    /429|too many|rate limit|限流|请求过于频繁/i.test(error?.message || "")
  );
}

function getRequestDelay() {
  return getUsageSyncDelayMs();
}

class CaowoError extends Error {
  constructor(message, status = 500, code = "AUTOCHECK_ERROR", details = null) {
    super(message);
    this.name = "CaowoError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function getAccounts() {
  const accounts = loadAccountsWithKeys();
  pruneRuntimeCaches(accounts);
  syncSessionStoreFile(accounts);
  syncApiKeyStoreFile(accounts);
  return accounts;
}

function getAccountByUsername(username) {
  return getAccounts().find((account) => account.username === username) || null;
}

function quotaToCurrency(rawQuota, rates = siteRates) {
  const quota = toNumber(rawQuota, 0);
  const displayType = String(rates.quotaDisplayType || "USD").toUpperCase();
  const quotaPerUnit = toNumber(rates.quotaPerUnit, DEFAULT_QUOTA_PER_UNIT);
  const displayRate =
    displayType === "CNY"
      ? toNumber(rates.usdExchangeRate, DEFAULT_USD_EXCHANGE_RATE)
      : displayType === "CUSTOM"
        ? toNumber(rates.customCurrencyExchangeRate, DEFAULT_CUSTOM_CURRENCY_EXCHANGE_RATE)
        : 1;
  if (displayType === "TOKENS") return roundMoney(quota);
  return roundMoney((quota / (quotaPerUnit > 0 ? quotaPerUnit : DEFAULT_QUOTA_PER_UNIT)) * displayRate);
}

function currencyToQuota(displayValue, rates = siteRates) {
  const value = toNumber(displayValue, 0);
  const displayType = String(rates.quotaDisplayType || "USD").toUpperCase();
  const quotaPerUnit = toNumber(rates.quotaPerUnit, DEFAULT_QUOTA_PER_UNIT);
  const displayRate =
    displayType === "USD"
      ? toNumber(rates.usdExchangeRate, DEFAULT_USD_EXCHANGE_RATE)
      : displayType === "CUSTOM"
        ? toNumber(rates.customCurrencyExchangeRate, DEFAULT_CUSTOM_CURRENCY_EXCHANGE_RATE)
        : 1;

  if (displayType === "TOKENS") return value;
  return (value / (displayRate > 0 ? displayRate : 1)) * (quotaPerUnit > 0 ? quotaPerUnit : DEFAULT_QUOTA_PER_UNIT);
}

function checkinRewardToCurrency(rawQuota, rates = siteRates) {
  return quotaToCurrency(rawQuota, rates);
}

function getAccountState(account) {
  const key = account.key || accountCacheKey(account);
  const cached = accountStateCache.get(key);
  if (!cached) {
    const initial = createInitialAccountState(account);
    accountStateCache.set(key, initial);
    return initial;
  }
  return ensureCurrentDayState(cached, account);
}

function setAccountState(account, nextState) {
  const key = account.key || accountCacheKey(account);
  accountStateCache.set(key, ensureCurrentDayState(nextState, account));
  clearDashboardCache();
}

function createInitialAccountState(account) {
  const persistedApiKey = readPersistedApiKey(account);
  return {
    username: account.username,
    displayName: account.username,
    apiKey: persistedApiKey?.apiKey || "",
    apiKeyUpdatedAt: persistedApiKey?.updatedAt || null,
    balance: 0,
    usedQuota: 0,
    totalQuota: 0,
    remainingQuota: 0,
    usagePercent: 0,
    currencySymbol: siteRates.currencySymbol,
    updatedAt: nowIso(),
    lastRemoteSyncAt: null,
    checkin: {
      dayKey: currentDayKey(),
      signedToday: false,
      status: "unknown",
      message: "等待同步",
      reward: 0,
      updatedAt: null,
      source: "cache"
    },
    usage: {
      dayKey: currentDayKey(),
      value: null,
      status: "pending",
      updatedAt: null,
      source: "pending"
    },
    raw: {
      balance: 0,
      usedQuota: 0,
      totalQuota: 0,
      remainingQuota: 0,
      todayUsedRaw: null,
      checkinRecords: []
    }
  };
}

function ensureCurrentDayState(state, account) {
  const today = currentDayKey();
  if (state.checkin.dayKey !== today || state.usage.dayKey !== today) {
    const next = {
      ...state,
      username: account.username,
      displayName: state.displayName || account.username,
      apiKey: state.apiKey || "",
      apiKeyUpdatedAt: state.apiKeyUpdatedAt || null,
      checkin: {
        dayKey: today,
        signedToday: false,
        status: "unknown",
        message: "等待同步",
        reward: 0,
        updatedAt: null,
        source: "cache"
      },
      usage: {
        dayKey: today,
        value: null,
        status: "pending",
        updatedAt: null,
        source: "pending"
      },
      raw: {
        ...state.raw,
        todayUsedRaw: null,
        checkinRecords: []
      }
    };
    accountStateCache.set(account.key || accountCacheKey(account), next);
    return next;
  }
  return state;
}

function updateAccountState(account, updater) {
  const current = getAccountState(account);
  const next = updater(structuredClone(current));
  setAccountState(account, next);
  return next;
}

function buildAccountView(state, account = {}, sessionStore = null) {
  const todayUsedValue = state.usage.value;
  const sessionExpiresAt = getAccountSessionExpiresAt(account, sessionStore);
  const totalQuota =
    state.totalQuota > 0
      ? state.totalQuota
      : roundMoney(state.balance + (state.usedQuota ?? 0));
  const remainingQuota = roundMoney(state.remainingQuota || state.balance || 0);
  const usedQuota =
    state.usedQuota > 0
      ? state.usedQuota
      : roundMoney(Math.max(totalQuota - remainingQuota, 0));
  const usagePercent =
    totalQuota <= 0
      ? 0
      : Math.round((usedQuota / totalQuota) * 1000) / 10;

  return {
    username: state.username,
    displayName: sanitizeDisplayName(state.displayName, state.username),
    userId: resolveAccountUserId(account, ""),
    authType: normalizeAccountAuthType(account),
    loginProvider: normalizeLoginProvider(account),
    credentialKind: getAccountCredentialKind(account),
    sessionExpiresAt: formatExpiresAtIso(sessionExpiresAt),
    sessionStatus: getSessionStatus(sessionExpiresAt),
    apiKey: state.apiKey || "",
    apiKeyUpdatedAt: state.apiKeyUpdatedAt || null,
    signedToday: state.checkin.signedToday,
    checkinStatus: CHECKIN_STATUSES.has(state.checkin.status) ? state.checkin.status : "unknown",
    checkinMessage: state.checkin.message,
    todayUsed: todayUsedValue,
    todayUsedRaw: state.raw.todayUsedRaw,
    todayUsedStatus: TODAY_USED_STATUSES.has(state.usage.status) ? state.usage.status : "pending",
    todayUsedUpdatedAt: state.usage.updatedAt,
    totalQuota,
    remainingQuota,
    balance: state.balance,
    usedQuota,
    usagePercent,
    lastCheckinReward: state.checkin.reward,
    currencySymbol: state.currencySymbol || siteRates.currencySymbol,
    updatedAt: state.updatedAt,
    dataSource: {
      checkin: state.checkin.source === "remote" ? "remote" : "cache",
      todayUsed:
        state.usage.source === "log-stat"
          ? "log-stat"
          : state.usage.source === "cache"
            ? "cache"
            : "pending"
    }
  };
}

function getAllAccountViews() {
  const sessionStore = readSessionStore();
  return getAccounts().map((account) => buildAccountView(getAccountState(account), account, sessionStore));
}

function normalizeRates(payload = {}) {
  const data = unwrap(payload) || {};
  const quotaPerUnit = toNumber(
    readPath(data, ["quota_per_unit", "quotaPerUnit", "quota.unit", "settings.quota_per_unit"]),
    DEFAULT_QUOTA_PER_UNIT
  );
  const quotaDisplayType = String(
    provider.quotaDisplayTypeOverride ||
      readPath(data, ["quota_display_type", "quotaDisplayType", "settings.quota_display_type"]) ||
      "USD"
  ).toUpperCase();
  const customCurrencySymbol =
    readPath(data, [
      "custom_currency_symbol",
      "currency_symbol",
      "currencySymbol",
      "settings.custom_currency_symbol"
    ]) || DEFAULT_CURRENCY_SYMBOL;

  return {
    quotaPerUnit: quotaPerUnit > 0 ? quotaPerUnit : DEFAULT_QUOTA_PER_UNIT,
    quotaUnitPrice: toNumber(
      readPath(data, [
        "price",
        "unit_price",
        "unitPrice",
        "stripe_unit_price",
        "settings.price",
        "settings.unit_price"
      ]),
      DEFAULT_QUOTA_UNIT_PRICE
    ),
    quotaDisplayType,
    usdExchangeRate: toNumber(
      readPath(data, ["usd_exchange_rate", "usdExchangeRate", "settings.usd_exchange_rate"]),
      DEFAULT_USD_EXCHANGE_RATE
    ),
    customCurrencyExchangeRate: toNumber(
      readPath(data, [
        "custom_currency_exchange_rate",
        "customCurrencyExchangeRate",
        "currency_exchange_rate",
        "settings.custom_currency_exchange_rate"
      ]),
      DEFAULT_CUSTOM_CURRENCY_EXCHANGE_RATE
    ),
    currencySymbol:
      provider.currencySymbolOverride ||
      (quotaDisplayType === "USD"
        ? "$"
        : quotaDisplayType === "CNY"
          ? "¥"
          : quotaDisplayType === "CUSTOM"
            ? customCurrencySymbol
            : DEFAULT_CURRENCY_SYMBOL)
  };
}

async function fetchSiteStatus() {
  if (siteRatesExpiresAt > Date.now()) return siteRates;
  if (isCoolingDown()) return siteRates;

  const endpoints = ["/api/status", "/api/system/status", "/api/setting"];
  for (const endpoint of endpoints) {
    try {
      const response = await client.get(endpoint);
      if (response.status === 404 || response.status === 405) continue;
      assertHttpOk(response, "读取站点配置");
      siteRates = normalizeRates(response.data);
      siteRatesExpiresAt = Date.now() + 5 * 60 * 1000;
      return siteRates;
    } catch (error) {
      if (isRateLimitError(error)) break;
    }
  }

  return siteRates;
}

function hasImportedSessionCredentials(account) {
  return Boolean(account?.token || account?.cookie);
}

function isModelApiKeyToken(value = "") {
  return /^sk-[a-z0-9]/i.test(String(value || "").trim());
}

function normalizeAccountAuthType(account = {}) {
  const raw = String(
    account.authType ||
      account.loginType ||
      account.loginProvider ||
      account.oauthProvider ||
      ""
  )
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");

  if (raw.includes("linuxdo")) return "linuxdo";
  if (raw.includes("oauth")) return "oauth";
  if (account.cookie) return "cookie";
  if (account.token) return isModelApiKeyToken(account.token) ? "api_key" : "token";
  if (account.password) return "password";
  return "unknown";
}

function normalizeLoginProvider(account = {}) {
  const raw = String(
    account.loginProvider ||
      account.oauthProvider ||
      account.authProvider ||
      account.authType ||
      ""
  )
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");

  if (raw.includes("linuxdo")) return "linuxdo";
  return "";
}

function isLinuxDoOAuthAccount(account = {}) {
  return (
    normalizeAccountAuthType(account) === "linuxdo" ||
    normalizeLoginProvider(account) === "linuxdo"
  );
}

function getAccountCredentialKind(account = {}) {
  if (account.cookie) return "cookie";
  if (account.token) return isModelApiKeyToken(account.token) ? "api_key" : "token";
  if (account.password) return "password";
  return "none";
}

function deriveTrailingNumericUserId(account) {
  if (!provider.deriveTrailingNumericUserId) return "";
  const candidates = [account?.userId, account?.username, account?.displayName].filter(Boolean);
  for (const candidate of candidates) {
    const match = String(candidate).trim().match(/(?:^|[_-])(\d+)$/);
    if (match) return match[1];
  }
  return "";
}

function resolveAccountUserId(account, fallback = account?.username) {
  return account?.userId || deriveTrailingNumericUserId(account) || fallback || "";
}

function isValidProviderUserId(userId) {
  if (!provider.requiresNumericUserId) return Boolean(userId);
  return /^\d+$/.test(String(userId || ""));
}

function assertProviderUserId(account, userId) {
  if (isValidProviderUserId(userId)) return;

  throw new CaowoError(
    `${provider.displayName} 需要数字 userId；请在导入内容里添加 userId，或使用 linuxdo_数字 这类账号名`,
    401,
    "AUTH_FAILED"
  );
}

function getImportedSessionExpiresAt(account) {
  if (!account?.expiresAt) {
    return Date.now() + (account?.cookie ? DEFAULT_IMPORTED_COOKIE_SESSION_TTL : DEFAULT_SESSION_TTL);
  }

  const numericExpiresAt = Number(account.expiresAt);
  if (Number.isFinite(numericExpiresAt)) {
    return numericExpiresAt > 10_000_000_000 ? numericExpiresAt : numericExpiresAt * 1000;
  }

  const parsedExpiresAt = Date.parse(account.expiresAt);
  return Number.isFinite(parsedExpiresAt) ? parsedExpiresAt : Date.now() + DEFAULT_SESSION_TTL;
}

function getExplicitAccountExpiresAt(account) {
  if (!account?.expiresAt) return null;

  const numericExpiresAt = Number(account.expiresAt);
  if (Number.isFinite(numericExpiresAt)) {
    return numericExpiresAt > 10_000_000_000 ? numericExpiresAt : numericExpiresAt * 1000;
  }

  const parsedExpiresAt = Date.parse(account.expiresAt);
  return Number.isFinite(parsedExpiresAt) ? parsedExpiresAt : null;
}

function getStoredSession(account, sessionStore = null) {
  const key = account?.key || accountCacheKey(account);
  return sessionCache.get(key) || sessionStore?.[key] || null;
}

function getAccountSessionExpiresAt(account, sessionStore = null) {
  const storedSession = getStoredSession(account, sessionStore);
  const storedExpiresAt = Number(storedSession?.expiresAt);
  if (Number.isFinite(storedExpiresAt) && storedExpiresAt > 0) return storedExpiresAt;
  return getExplicitAccountExpiresAt(account);
}

function getSessionStatus(expiresAt) {
  if (!expiresAt) return "unknown";
  if (expiresAt <= Date.now()) return "expired";
  if (expiresAt - Date.now() <= 3 * 24 * 60 * 60 * 1000) return "expiring";
  return "valid";
}

function formatExpiresAtIso(expiresAt) {
  return expiresAt ? new Date(expiresAt).toISOString() : null;
}

function createImportedSession(account) {
  const tokenLooksLikeApiKey = isModelApiKeyToken(account.token);
  if (tokenLooksLikeApiKey && !account.cookie) {
    throw new CaowoError(
      "sk- 开头的是模型 API Key，不是 MUYUAN 网页登录态；LinuxDo 登录账号请导入浏览器里的 session/cookie 和数字 userId。",
      401,
      "AUTH_FAILED"
    );
  }

  const expiresAt = getImportedSessionExpiresAt(account);
  if (expiresAt <= Date.now()) {
    throw new CaowoError("导入的登录态已过期，请重新从浏览器复制 session/cookie", 401, "AUTH_FAILED");
  }

  const displayName =
    sanitizeDisplayName(account.displayName, account.username) || account.username;
  const userId = resolveAccountUserId(account);
  assertProviderUserId(account, userId);

  return {
    username: account.username,
    displayName: String(displayName),
    userId,
    token: tokenLooksLikeApiKey ? "" : account.token || "",
    cookie: account.cookie || "",
    authType: normalizeAccountAuthType(account),
    loginProvider: normalizeLoginProvider(account),
    loginUser: sanitizeUserForSession({
      id: userId,
      username: account.username,
      display_name: displayName
    }),
    expiresAt
  };
}

async function loginAccount(account, { force = false } = {}) {
  const key = sessionCacheKey(account);
  const cached = sessionCache.get(key);
  if (
    !force &&
    cached &&
    hasSessionAuth(cached) &&
    cached.expiresAt > Date.now() &&
    isValidProviderUserId(cached.userId)
  ) {
    return cached;
  }

  const persisted = readSessionStore()[key];
  if (
    !force &&
    persisted &&
    hasSessionAuth(persisted) &&
    persisted.expiresAt > Date.now() &&
    isValidProviderUserId(persisted.userId)
  ) {
    const hydratedSession = {
      ...persisted,
      accountKey: key,
      authType: persisted.authType || normalizeAccountAuthType(account),
      loginProvider: persisted.loginProvider || normalizeLoginProvider(account)
    };
    sessionCache.set(key, hydratedSession);
    return hydratedSession;
  }

  if (isCoolingDown()) {
    throw new CaowoError(cooldownMessage(), 429, "RATE_LIMIT_COOLDOWN");
  }

  if (hasImportedSessionCredentials(account)) {
    const importedSession = {
      ...createImportedSession(account),
      accountKey: key
    };
    sessionCache.set(key, importedSession);
    const sessionStore = readSessionStore();
    sessionStore[key] = importedSession;
    writeSessionStore(sessionStore);
    clearAuthFailedAlert(account.username);
    return importedSession;
  }

  if (!account.password) {
    registerAuthFailedAlert(account.username);
    throw new CaowoError("账号缺少密码或导入登录态，无法登录站点", 401, "AUTH_FAILED");
  }

  if (isLinuxDoOAuthAccount(account)) {
    registerAuthFailedAlert(account.username);
    throw new CaowoError(
      "LinuxDo OAuth 账号不能用 LinuxDo 密码直连 MUYUAN；请在浏览器完成 LinuxDo 登录后导入 MUYUAN session/cookie。",
      401,
      "AUTH_FAILED"
    );
  }

  const response = assertHttpOk(
    await client.post("/api/user/login", {
      username: account.username,
      password: account.password
    }),
    "登录"
  );

  if (!isSuccessEnvelope(response.data)) {
    registerAuthFailedAlert(account.username);
    throw new CaowoError(messageFrom(response.data, "账号或密码错误"), 401, "AUTH_FAILED");
  }

  const data = unwrap(response.data);
  const user = data?.user && typeof data.user === "object" ? data.user : data;
  const token = readPath(data, [
    "token",
    "access_token",
    "accessToken",
    "user.token",
    "user.access_token",
    "session.token"
  ]);
  const userId =
    readPath(data, ["id", "user_id", "userId", "user.id", "user.user_id"]) ||
    resolveAccountUserId(account);
  assertProviderUserId(account, userId);
  const displayName =
    sanitizeDisplayName(
      readPath(user, ["display_name", "displayName", "nickname", "name", "username"]),
      account.username
    ) ||
    account.username;

  const session = {
    username: account.username,
    displayName: String(displayName),
    userId,
    token: token ? String(token) : "",
    cookie: extractCookie(response.headers),
    accountKey: key,
    authType: normalizeAccountAuthType(account),
    loginProvider: normalizeLoginProvider(account),
    loginUser: sanitizeUserForSession(user),
    expiresAt: Date.now() + DEFAULT_SESSION_TTL
  };

  sessionCache.set(key, session);
  const sessionStore = readSessionStore();
  sessionStore[key] = session;
  writeSessionStore(sessionStore);
  clearAuthFailedAlert(account.username);
  return session;
}

async function withAccountSession(account, worker) {
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let session;
    try {
      session = await loginAccount(account, { force: attempt > 0 });
    } catch (error) {
      if (error?.code === "AUTH_FAILED") {
        registerAuthFailedAlert(account.username);
      }
      throw error;
    }

    try {
      return await worker(session);
    } catch (error) {
      lastError = error;
      if (error?.code === "AUTH_FAILED" && attempt === 0) {
        invalidateSession(account);
        continue;
      }
      if (error?.code === "AUTH_FAILED") {
        registerAuthFailedAlert(account.username);
      }
      throw error;
    }
  }

  throw lastError;
}

async function fetchSelf(session) {
  const endpoints = ["/api/user/self", "/api/user/info", "/api/user"];
  for (const endpoint of endpoints) {
    const response = await authedGet(session, endpoint);
    if (response.status === 404 || response.status === 405) continue;
    assertHttpOk(response, "读取账号信息");
    if (!isSuccessEnvelope(response.data)) {
      throw new CaowoError(messageFrom(response.data, "读取账号信息失败"), response.status);
    }
    return unwrap(response.data) || {};
  }

  if (session.loginUser) {
    return session.loginUser;
  }

  throw new CaowoError("无法读取账号信息，站点接口不兼容", 502);
}

function normalizeCheckinStats(payload = {}) {
  const data = unwrap(payload) || {};
  const stats = data.stats && typeof data.stats === "object" ? data.stats : data;
  const records = Array.isArray(stats.records) ? stats.records : [];
  const today = currentDayKey();
  const todayRecord = records.find(
    (record) => String(record.checkin_date || record.date || "").slice(0, 10) === today
  );
  const checkedInToday = readPath(stats, [
    "checked_in_today",
    "checkedInToday",
    "signed_today",
    "signedToday"
  ]);

  return {
    signedToday:
      typeof checkedInToday === "boolean"
        ? checkedInToday
        : Boolean(todayRecord),
    rewardRaw: toNumber(
      todayRecord?.quota_awarded ||
        readPath(stats, ["today_quota", "todayQuota", "last_quota", "lastQuota"]),
      0
    ),
    records: records.map((record) => ({
      date: String(record.checkin_date || record.date || ""),
      quotaAwarded: toNumber(record.quota_awarded ?? record.quotaAwarded, 0)
    }))
  };
}

async function fetchTrendCheckinStats(session) {
  const statsTemplate = String(provider.checkinStatsEndpoint || "").trim();
  if (!statsTemplate) return null;

  const monthKeys = getRecentMonthKeys();
  const normalizedResponses = [];

  for (const monthKey of monthKeys) {
    const endpoint = statsTemplate.replace("{month}", encodeURIComponent(monthKey));
    const response = await authedGet(session, endpoint);

    debugLog("checkin-status", {
      username: session.username,
      month: monthKey,
      status: response.status,
      success: response.data?.success,
      message: response.data?.message,
      checkedInToday: response.data?.data?.stats?.checked_in_today
    });

    if (response.status === 401 || response.status === 403) {
      throw new CaowoError("登录已失效，请重新同步", response.status, "AUTH_FAILED");
    }
    if ([400, 404, 405].includes(response.status)) {
      continue;
    }

    assertHttpOk(response, "读取签到状态");
    if (!isSuccessEnvelope(response.data)) {
      continue;
    }

    normalizedResponses.push(normalizeCheckinStats(response.data));
  }

  if (!normalizedResponses.length) {
    return null;
  }

  const recordsByDay = new Map();
  for (const stats of normalizedResponses) {
    for (const record of stats.records || []) {
      const dayKey = String(record.date || "").slice(0, 10);
      if (!dayKey) continue;
      recordsByDay.set(dayKey, toNumber(recordsByDay.get(dayKey), 0) + toNumber(record.quotaAwarded, 0));
    }
  }

  const records = getRecentDayKeys()
    .filter((dayKey) => recordsByDay.has(dayKey))
    .map((dayKey) => ({
      date: dayKey,
      quotaAwarded: recordsByDay.get(dayKey)
    }));
  const todayRecord = records.find((record) => record.date === currentDayKey());
  const latestStats = normalizedResponses[normalizedResponses.length - 1];

  return {
    signedToday: normalizedResponses.some((stats) => stats.signedToday) || Boolean(todayRecord),
    rewardRaw: toNumber(todayRecord?.quotaAwarded, latestStats?.rewardRaw ?? 0),
    records
  };
}

function getPayloadRows(payload = {}) {
  const data = unwrap(payload) || {};
  const rows = Array.isArray(data) ? data : data.items || data.logs || data.records || data.data;
  return Array.isArray(rows) ? rows : [];
}

function isConsumptionLogRow(row) {
  const type = readPath(row, ["type", "log_type", "logType"]);
  if (type === undefined || type === null || type === "") return true;
  const normalizedType = String(type).trim().toLowerCase();
  return normalizedType === "2" || normalizedType === "consume" || normalizedType === "consumption";
}

function sumArrayQuota(rows) {
  if (!Array.isArray(rows)) return 0;
  return rows.reduce((sum, row) => {
    if (!isConsumptionLogRow(row)) return sum;
    const raw =
      readPath(row, [
        "quota",
        "used_quota",
        "consume_quota",
        "quota_used",
        "amount",
        "value",
        "cost"
      ]) || 0;
    return sum + Math.max(toNumber(raw, 0), 0);
  }, 0);
}

function normalizeUsageStats(payload = {}) {
  const data = unwrap(payload) || {};
  const rows = getPayloadRows(payload);
  const directValue = toNumber(
    readPath(data, [
      "today_used_quota",
      "todayUsedQuota",
      "today_used",
      "used_quota_today",
      "quota_today",
      "usage_quota",
      "today_consume_quota",
      "todayConsumeQuota",
      "daily_used_quota",
      "dailyUsedQuota"
    ]),
    NaN
  );

  if (Number.isFinite(directValue)) {
    return { todayUsedRaw: directValue };
  }

  return { todayUsedRaw: sumArrayQuota(rows) };
}

async function fetchTodayUsageFromLogs(session, start, end) {
  let totalRaw = 0;

  for (let page = 1; page <= MAX_USAGE_LOG_PAGES; page += 1) {
    const params = new URLSearchParams({
      p: String(page),
      page_size: String(USAGE_LOG_PAGE_SIZE),
      type: "2",
      token_name: "",
      model_name: "",
      start_timestamp: String(start),
      end_timestamp: String(end),
      group: "",
      request_id: ""
    });
    const response = await authedGet(session, `/api/log/self/?${params.toString()}`);

    if (response.status === 401 || response.status === 403) {
      throw new CaowoError("登录已失效，请重新同步", response.status, "AUTH_FAILED");
    }
    if ([400, 404, 405].includes(response.status)) {
      return null;
    }

    assertHttpOk(response, "读取当日消费日志");
    if (!isSuccessEnvelope(response.data)) {
      return null;
    }

    const data = unwrap(response.data) || {};
    const rows = getPayloadRows(response.data);
    totalRaw += sumArrayQuota(rows);

    const total = toNumber(readPath(data, ["total", "count", "total_count", "totalCount"]), NaN);
    const pageSize = toNumber(
      readPath(data, ["page_size", "pageSize", "limit"]),
      USAGE_LOG_PAGE_SIZE
    );
    if (!Number.isFinite(total) || total <= page * pageSize || rows.length < pageSize) {
      return { todayUsedRaw: totalRaw };
    }
  }

  return { todayUsedRaw: totalRaw };
}

async function fetchTodayUsageStats(session) {
  const { start, end } = todayRangeSeconds();
  const logStats = await fetchTodayUsageFromLogs(session, start, end);
  if (logStats) return logStats;

  const endpoints = [
    `/api/data/self?start_timestamp=${start}&end_timestamp=${end}`,
    `/api/user/usage?start_timestamp=${start}&end_timestamp=${end}`
  ];

  for (const endpoint of endpoints) {
    const response = await authedGet(session, endpoint);
    if ([400, 401, 403, 404, 405].includes(response.status)) {
      if (response.status === 401 || response.status === 403) {
        throw new CaowoError("登录已失效，请重新同步", response.status, "AUTH_FAILED");
      }
      continue;
    }

    assertHttpOk(response, "读取当日用量");
    if (!isSuccessEnvelope(response.data)) {
      continue;
    }

    return normalizeUsageStats(response.data);
  }

  return null;
}

function mergeBaseInfoFromUser(state, user) {
  const rawBalance = toNumber(readPath(user, ["quota"]), 0);
  const rawUsedQuota = toNumber(
    readPath(user, ["used_quota", "usedQuota", "quota_used", "quotaUsed", "used"]),
    0
  );
  const rawTotal = toNumber(
    readPath(user, [
      "total_quota",
      "totalQuota",
      "quota_limit",
      "quotaLimit",
      "daily_quota",
      "dailyQuota"
    ]),
    0
  );
  const rawTotalFromUsage = rawBalance + rawUsedQuota;
  const normalizedRawTotal = rawTotal > 0 ? rawTotal : rawTotalFromUsage;
  const normalizedRawUsedQuota =
    rawUsedQuota > 0
      ? rawUsedQuota
      : rawTotal > rawBalance
        ? rawTotal - rawBalance
        : 0;
  const displayName =
    sanitizeDisplayName(
      readPath(user, ["display_name", "displayName", "nickname", "name", "username"]),
      state.displayName || state.username
    ) || state.displayName || state.username;

  state.displayName = displayName;
  state.balance = quotaToCurrency(rawBalance, siteRates);
  state.usedQuota = quotaToCurrency(normalizedRawUsedQuota, siteRates);
  state.totalQuota =
    normalizedRawTotal > 0 ? quotaToCurrency(normalizedRawTotal, siteRates) : state.balance;
  state.remainingQuota = state.balance;
  state.currencySymbol = siteRates.currencySymbol;
  state.updatedAt = nowIso();
  state.lastRemoteSyncAt = nowIso();
  state.raw.balance = rawBalance;
  state.raw.usedQuota = normalizedRawUsedQuota;
  state.raw.totalQuota = normalizedRawTotal;
  state.raw.remainingQuota = rawBalance;
  return state;
}

function applyCheckinStats(state, checkinStats, source = "remote") {
  if (!checkinStats) return state;
  state.checkin.dayKey = currentDayKey();
  state.checkin.signedToday = Boolean(checkinStats.signedToday);
  state.checkin.status = checkinStats.signedToday ? "checked" : "unchecked";
  state.checkin.message = checkinStats.signedToday ? "今日已签到" : "待签到";
  state.checkin.reward = checkinRewardToCurrency(checkinStats.rewardRaw, siteRates);
  state.checkin.updatedAt = nowIso();
  state.checkin.source = source;
  state.raw.checkinRecords = checkinStats.records || [];
  return state;
}

function applyUsageStats(state, usageStats, source = "log-stat") {
  state.usage.dayKey = currentDayKey();
  if (!usageStats || usageStats.todayUsedRaw == null || Number.isNaN(usageStats.todayUsedRaw)) {
    state.usage.value = state.usage.updatedAt ? state.usage.value : null;
    state.usage.status = state.usage.updatedAt ? "stale" : "unavailable";
    state.usage.source = state.usage.updatedAt ? "cache" : "pending";
    state.updatedAt = nowIso();
    return state;
  }

  state.raw.todayUsedRaw = usageStats.todayUsedRaw;
  state.usage.value = quotaToCurrency(usageStats.todayUsedRaw, siteRates);
  state.usage.status = "exact";
  state.usage.updatedAt = nowIso();
  state.usage.source = source;
  state.updatedAt = nowIso();
  return state;
}

function applyBrowserSnapshot(account, snapshot = {}) {
  if (!snapshot || typeof snapshot !== "object") return null;

  const state = updateAccountState(account, (nextState) => {
    if (snapshot.user && typeof snapshot.user === "object") {
      mergeBaseInfoFromUser(nextState, snapshot.user);
    }

    if (snapshot.usage && typeof snapshot.usage === "object") {
      applyUsageStats(nextState, snapshot.usage, "browser");
    }

    if (snapshot.checkin && typeof snapshot.checkin === "object") {
      applyCheckinStats(nextState, snapshot.checkin, "browser");
    }

    nextState.updatedAt = nowIso();
    nextState.lastRemoteSyncAt = nowIso();
    return nextState;
  });

  clearAuthFailedAlert(account.username);
  clearSyncTimeoutAlert(account.username);
  return state;
}

function markUsageStale(account) {
  updateAccountState(account, (state) => {
    state.usage.dayKey = currentDayKey();
    state.usage.status = state.usage.updatedAt ? "stale" : "pending";
    state.usage.source = state.usage.updatedAt ? "cache" : "pending";
    state.updatedAt = nowIso();
    return state;
  });
}

async function syncAccountUsage(account) {
  if (isCoolingDown()) {
    throw new CaowoError(cooldownMessage(), 429, "RATE_LIMIT_COOLDOWN");
  }

  await fetchSiteStatus();
  return withAccountSession(account, async (session) => {
    const apiKey = await fetchAccountApiKey(session);
    if (apiKey && !isMaskedApiKey(apiKey)) {
      writePersistedApiKey(account, apiKey);
    }
    if (apiKey !== null) {
      updateAccountState(account, (state) => applyAccountApiKey(state, apiKey));
    }

    const user = await fetchSelf(session);
    const checkinStats = await fetchTrendCheckinStats(session);
    const usageStats = await fetchTodayUsageStats(session);

    updateAccountState(account, (state) => {
      applyAccountApiKey(state, apiKey);
      mergeBaseInfoFromUser(state, user);
      if (checkinStats) {
        applyCheckinStats(state, checkinStats, "remote");
      } else if (state.checkin.status === "unknown") {
        state.checkin.message = "等待同步签到状态";
      }
      applyUsageStats(state, usageStats, usageStats ? "log-stat" : "pending");
      return state;
    });

    clearAuthFailedAlert(account.username);
    clearSyncTimeoutAlert(account.username);
    usageSyncQueue.syncedUsernames.add(account.username);
    usageSyncQueue.failedUsernames.delete(account.username);
    return getAccountState(account);
  });
}

function parseRewardRaw(payload) {
  const data = unwrap(payload) || {};
  const directReward = toNumber(
    readPath(data, [
      "reward_quota",
      "rewardQuota",
      "quota",
      "amount",
      "reward",
      "quota_awarded",
      "checkin_reward",
      "checkinReward",
      "data.quota_awarded",
      "data.reward_quota",
      "data.quota"
    ]),
    0
  );
  if (directReward > 0) return directReward;

  const message = messageFrom(payload, "");
  const displayRewardMatch = String(message).match(/(?:\$|USD|美元|美金)\s*([\d.]+)|([\d.]+)\s*(?:\$|USD|美元|美金)/i);
  const displayReward = toNumber(displayRewardMatch?.[1] || displayRewardMatch?.[2], NaN);
  if (Number.isFinite(displayReward) && displayReward > 0) {
    return currencyToQuota(displayReward);
  }

  return 0;
}

function isAlreadyCheckedMessage(message) {
  return /已签到|已经签到|already|signed/i.test(message || "");
}

function updateCheckinQueueProgressMessage() {
  const progress = getCheckinQueueProgress();
  const totalDone = progress.completed + progress.failed + progress.skipped;

  if (checkinQueue.status === "cooldown") {
    checkinQueue.message = cooldownMessage();
  } else if (checkinQueue.status === "completed") {
    checkinQueue.message = `签到队列完成：已处理 ${totalDone}/${progress.total}`;
  } else if (checkinQueue.status === "running") {
    checkinQueue.message = `签到进行中：已处理 ${totalDone}/${progress.total}`;
  } else if (checkinQueue.status === "paused") {
    checkinQueue.message = "签到队列已暂停";
  } else {
    checkinQueue.message = "等待开始";
  }

  checkinQueue.updatedAt = nowIso();
}

function getCheckinQueueProgress() {
  const progress = createQueueProgress();
  progress.total = checkinQueue.items.length;

  for (const item of checkinQueue.items) {
    if (item.status === "completed") progress.completed += 1;
    else if (item.status === "failed") progress.failed += 1;
    else if (item.status === "skipped") progress.skipped += 1;
    else progress.pending += 1;
  }

  return progress;
}

function getUnsignedAccountUsernames(dayKey = currentDayKey()) {
  return getAccounts()
    .filter((account) => {
      const state = getAccountState(account);
      return state.checkin.dayKey !== dayKey || !state.checkin.signedToday;
    })
    .map((account) => account.username);
}

function isAutoCheckinCompletedForDay(dayKey = currentDayKey()) {
  const accounts = getAccounts();
  if (!accounts.length) return false;
  return !getUnsignedAccountUsernames(dayKey).length;
}

function recordAutoCheckinQueueResult(progress = getCheckinQueueProgress()) {
  const config = getAutoCheckinConfig();
  const completedAt = new Date();
  const todayKey = getDayKeyForDate(completedAt, config.timezone);
  const store = autoCheckinScheduler.store;

  if (store.activeDay !== todayKey) return;
  if (progress.pending > 0) return;

  const completedAtIso = completedAt.toISOString();
  const processed = progress.completed + progress.skipped + progress.failed;
  const unsignedUsernames = getUnsignedAccountUsernames(todayKey);

  if (progress.total > 0 && processed === progress.total && !unsignedUsernames.length) {
    updateAutoCheckinStore({
      lastTriggeredDay: todayKey,
      lastCompletedDay: todayKey,
      lastCompletedAt: completedAtIso,
      lastAttemptAt: completedAtIso,
      lastErrorMessage: null,
      activeDay: null
    });
    return;
  }

  updateAutoCheckinStore({
    lastTriggeredDay: null,
    lastCompletedDay: null,
    lastCompletedAt: null,
    lastAttemptAt: completedAtIso,
    lastErrorMessage:
      unsignedUsernames.length
        ? `Auto check-in incomplete: unsigned accounts ${unsignedUsernames.join(", ")}`
        : progress.total > 0
          ? `Auto check-in incomplete: ${progress.failed}/${progress.total} accounts failed`
          : "Auto check-in queue finished without accounts",
    activeDay: null
  });
}

function getUsageSyncProgress() {
  const progress = createQueueProgress();
  progress.total = usageSyncQueue.order.length;

  for (const username of usageSyncQueue.order) {
    if (usageSyncQueue.syncedUsernames.has(username)) progress.completed += 1;
    else if (usageSyncQueue.failedUsernames.has(username)) progress.failed += 1;
    else progress.pending += 1;
  }

  return progress;
}

function getUsagePendingCount() {
  return getUsageSyncProgress().pending;
}

function serializeCheckinQueue() {
  let status = checkinQueue.status;
  if (status !== "running" && isCoolingDown() && getCheckinQueueProgress().pending > 0) {
    status = "cooldown";
  }

  return {
    status,
    scope: checkinQueue.scope,
    progress: getCheckinQueueProgress(),
    cooldownUntil:
      status === "cooldown" || status === "running" ? getCooldownUntilIso() : checkinQueue.cooldownUntil,
    currentUsername: checkinQueue.currentUsername,
    updatedAt: checkinQueue.updatedAt,
    message:
      status === "cooldown" && isCoolingDown() ? cooldownMessage() : checkinQueue.message || "等待开始"
  };
}

function serializeUsageSyncQueue() {
  const progress = getUsageSyncProgress();
  let status = usageSyncQueue.status;

  if (!usageSyncQueue.running && progress.pending === 0 && progress.total > 0) {
    status = "completed";
  }

  if (status !== "running" && isCoolingDown() && progress.pending > 0) {
    status = "cooldown";
  }

  return {
    status,
    progress,
    cooldownUntil:
      status === "cooldown" || status === "running" ? getCooldownUntilIso() : usageSyncQueue.cooldownUntil,
    currentUsername: usageSyncQueue.currentUsername,
    updatedAt: usageSyncQueue.updatedAt,
    message:
      status === "cooldown" && isCoolingDown() ? cooldownMessage() : usageSyncQueue.message || "等待同步"
  };
}

function serializeAutoCheckinState() {
  const config = getAutoCheckinConfig();
  const store = autoCheckinScheduler.store;
  const now = new Date();
  const todayKey = getDayKeyForDate(now, config.timezone);
  const lastAttemptAt = store.lastAttemptAt ? new Date(store.lastAttemptAt) : null;
  const lastErrorMessage =
    lastAttemptAt && isSameZonedDay(lastAttemptAt, now, config.timezone)
      ? store.lastErrorMessage
      : null;

  let status = "disabled";
  if (config.enabled) {
    status = "scheduled";
    if (isAutoCheckinCompletedForDay(todayKey)) {
      if (checkinQueue.status === "cooldown") status = "cooldown";
      else if ((checkinQueue.running || checkinQueue.status === "running") && hasPendingCheckinItems()) status = "running";
      else status = "triggered";
    } else if (store.activeDay === todayKey && hasPendingCheckinItems()) {
      status = checkinQueue.status === "cooldown" ? "cooldown" : "running";
    } else if (lastErrorMessage) {
      status = "retrying";
    }
  }

  return {
    enabled: config.enabled,
    time: config.time,
    timezone: config.timezone,
    catchUpEnabled: config.catchUpEnabled,
    nextRunAt: getNextAutoCheckinRunAt(config, store, now),
    lastTriggeredAt: store.lastTriggeredAt,
    lastTriggeredDay: store.lastTriggeredDay,
    lastCompletedAt: store.lastCompletedAt,
    lastCompletedDay: store.lastCompletedDay,
    lastAttemptAt: store.lastAttemptAt,
    lastErrorMessage,
    status
  };
}

function buildSyncState() {
  return {
    checkinQueue: serializeCheckinQueue(),
    usageSync: serializeUsageSyncQueue(),
    autoCheckin: serializeAutoCheckinState()
  };
}

function buildQueueItems(scope = "all") {
  const accounts = getAccounts();
  const failedUsernames = checkinQueue.lastFailedUsernames;

  return accounts
    .filter((account) => (scope === "failed" ? failedUsernames.has(account.username) : true))
    .map((account) => {
      const state = getAccountState(account);
      if (state.checkin.signedToday) {
        return {
          username: account.username,
          status: "skipped",
          attempts: 0,
          message: "使用本地签到缓存，跳过远程请求",
          reward: state.checkin.reward
        };
      }

      return {
        username: account.username,
        status: "pending",
        attempts: 0,
        message: "等待签到",
        reward: state.checkin.reward
      };
    });
}

function hasPendingCheckinItems(items = checkinQueue.items) {
  return items.some((item) => item.status === "pending");
}

function clearCheckinResumeTimer() {
  if (checkinQueue.resumeTimer) {
    clearTimeout(checkinQueue.resumeTimer);
    checkinQueue.resumeTimer = null;
  }
}

function scheduleCheckinResumeAfterCooldown() {
  clearCheckinResumeTimer();
  if (!isCoolingDown()) {
    queueMicrotask(() => {
      void runCheckinQueue();
    });
    return;
  }

  const delayMs = Math.max(0, rateLimitUntil - Date.now()) + 200;
  checkinQueue.resumeTimer = setTimeout(() => {
    checkinQueue.resumeTimer = null;
    if (checkinQueue.autoResume) {
      void runCheckinQueue();
    }
  }, delayMs);
}

function scheduleUsageResumeAfterCooldown() {
  if (usageSyncQueue.resumeTimer) {
    clearTimeout(usageSyncQueue.resumeTimer);
    usageSyncQueue.resumeTimer = null;
  }

  if (!isCoolingDown()) {
    queueMicrotask(() => {
      void runUsageSyncQueue();
    });
    return;
  }

  const delayMs = Math.max(0, rateLimitUntil - Date.now()) + 500;
  usageSyncQueue.resumeTimer = setTimeout(() => {
    usageSyncQueue.resumeTimer = null;
    void runUsageSyncQueue();
  }, delayMs);
}

function ensureCheckinQueue(scope = "all") {
  if (checkinQueue.running) {
    return serializeCheckinQueue();
  }

  const hasPendingItems = hasPendingCheckinItems();
  if (hasPendingItems && checkinQueue.scope === scope) {
    checkinQueue.status = isCoolingDown() ? "cooldown" : "running";
    checkinQueue.cooldownUntil = isCoolingDown() ? getCooldownUntilIso() : null;
    updateCheckinQueueProgressMessage();

    if (isCoolingDown()) {
      scheduleCheckinResumeAfterCooldown();
    } else {
      queueMicrotask(() => {
        void runCheckinQueue();
      });
    }

    return serializeCheckinQueue();
  }

  const nextItems = buildQueueItems(scope);
  const hasPendingItemsInNextQueue = hasPendingCheckinItems(nextItems);
  checkinQueue.scope = scope;
  checkinQueue.items = nextItems;
  checkinQueue.currentUsername = null;
  checkinQueue.status = hasPendingItemsInNextQueue
    ? isCoolingDown()
      ? "cooldown"
      : "running"
    : "completed";
  checkinQueue.delayMs = getCheckinInitialDelayMs();
  checkinQueue.autoResume = hasPendingItemsInNextQueue;
  checkinQueue.cooldownUntil =
    hasPendingItemsInNextQueue && isCoolingDown() ? getCooldownUntilIso() : null;
  updateCheckinQueueProgressMessage();

  if (hasPendingItemsInNextQueue) {
    if (isCoolingDown()) {
      scheduleCheckinResumeAfterCooldown();
    } else {
      queueMicrotask(() => {
        void runCheckinQueue();
      });
    }
  }

  return serializeCheckinQueue();
}

function prioritizeUsageSync(priorityUsernames = [], selectedUsername = null) {
  if (selectedUsername) {
    usageSyncQueue.selectedUsername = selectedUsername;
  }

  for (const username of priorityUsernames.filter(Boolean)) {
    usageSyncQueue.priorityUsernames.add(username);
  }

  const accounts = getAccounts();
  const prioritized = [];
  const pushUsername = (username) => {
    if (!username) return;
    if (prioritized.includes(username)) return;
    const account = accounts.find((item) => item.username === username);
    if (!account) return;
    prioritized.push(username);
  };

  for (const item of checkinQueue.items.filter((entry) => entry.status === "pending")) {
    pushUsername(item.username);
  }

  pushUsername(usageSyncQueue.selectedUsername);
  for (const username of usageSyncQueue.priorityUsernames) {
    pushUsername(username);
  }

  for (const account of accounts) {
    pushUsername(account.username);
  }

  usageSyncQueue.order = prioritized;
  usageSyncQueue.updatedAt = nowIso();
}

function kickUsageSync({ priorityUsernames = [], selectedUsername = null } = {}) {
  prioritizeUsageSync(priorityUsernames, selectedUsername);

  if (!usageSyncQueue.running) {
    usageSyncQueue.failedUsernames.clear();

    for (const account of getAccounts()) {
      const state = getAccountState(account);
      if (state.usage.status !== "exact") {
        usageSyncQueue.syncedUsernames.delete(account.username);
      }
    }
  }

  if (usageSyncQueue.running) {
    return serializeUsageSyncQueue();
  }

  if (getUsagePendingCount() === 0) {
    usageSyncQueue.status = "completed";
    usageSyncQueue.currentUsername = null;
    usageSyncQueue.message = "当日用量已同步";
    usageSyncQueue.cooldownUntil = null;
    usageSyncQueue.updatedAt = nowIso();
    return serializeUsageSyncQueue();
  }

  usageSyncQueue.status = isCoolingDown() ? "cooldown" : "running";
  usageSyncQueue.message = isCoolingDown() ? cooldownMessage() : "后台同步当日用量";
  usageSyncQueue.updatedAt = nowIso();

  if (isCoolingDown()) {
    scheduleUsageResumeAfterCooldown();
  } else {
    queueMicrotask(() => {
      void runUsageSyncQueue();
    });
  }

  return serializeUsageSyncQueue();
}

function getWebAccessPaths() {
  return String(provider.webAccessPaths || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

async function visitProviderWebPages(session) {
  const paths = getWebAccessPaths();
  if (!paths.length) return;

  for (const path of paths) {
    try {
      await authedGet(session, path, {
        headers: {
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
        }
      });
    } catch (error) {
      debugLog("web-access-visit-failed", {
        username: session.username,
        path,
        status: error?.status || error?.response?.status,
        message: error?.message
      });
    }
  }
}

function getCheckinEndpoint() {
  return String(provider.checkinEndpoint || "/api/user/checkin").trim() || "/api/user/checkin";
}

async function fastCheckinAccount(account) {
  const state = getAccountState(account);
  if (state.checkin.signedToday) {
    return {
      message: "今日已签到",
      rewardRaw: 0,
      signedToday: true,
      status: "checked"
    };
  }

  return withAccountSession(account, async (session) => {
    await visitProviderWebPages(session);

    try {
      const checkinStats = await fetchTrendCheckinStats(session);
      if (checkinStats?.signedToday) {
        return {
          message: "今日已签到",
          rewardRaw: checkinStats.rewardRaw || 0,
          signedToday: true,
          status: "checked"
        };
      }
    } catch (error) {
      if (error?.code === "AUTH_FAILED" || isRateLimitError(error)) {
        throw error;
      }
      debugLog("checkin-preflight-failed", {
        username: account.username,
        status: error?.status || error?.response?.status,
        message: error?.message
      });
    }

    const response = await authedPost(session, getCheckinEndpoint(), null);

    assertHttpOk(response, "签到");
    const responseMessage = messageFrom(response.data, "签到完成");
    if (!isSuccessEnvelope(response.data) && !isAlreadyCheckedMessage(responseMessage)) {
      throw new CaowoError(responseMessage, response.status, "CHECKIN_FAILED", response.data);
    }

    return {
      message: isAlreadyCheckedMessage(responseMessage) ? "今日已签到" : responseMessage,
      rewardRaw: parseRewardRaw(response.data),
      signedToday: true,
      status: "checked"
    };
  });
}

function recordCheckinSuccess(account, result, source = "remote") {
  updateAccountState(account, (state) => {
    state.checkin.dayKey = currentDayKey();
    state.checkin.signedToday = true;
    state.checkin.status = "checked";
    state.checkin.message = result.message || "今日已签到";
    state.checkin.reward =
      result.rewardRaw > 0 ? checkinRewardToCurrency(result.rewardRaw, siteRates) : state.checkin.reward;
    state.checkin.updatedAt = nowIso();
    state.checkin.source = source;
    state.currencySymbol = siteRates.currencySymbol;
    state.updatedAt = nowIso();
    return state;
  });
}

function recordCheckinFailure(account, message) {
  updateAccountState(account, (state) => {
    state.checkin.dayKey = currentDayKey();
    state.checkin.status = "failed";
    state.checkin.message = message || "签到失败";
    state.checkin.updatedAt = nowIso();
    state.checkin.source = "cache";
    state.updatedAt = nowIso();
    return state;
  });
}

function needsCheckinStatusSync(account, dayKey = currentDayKey()) {
  const state = getAccountState(account);
  return (
    state.checkin.dayKey !== dayKey ||
    state.checkin.status === "unknown" ||
    state.checkin.status === "failed" ||
    !state.checkin.signedToday
  );
}

function needsBaseInfoSync(account) {
  const state = getAccountState(account);
  return !state.lastRemoteSyncAt;
}

function shouldSyncCheckinStatuses(force = false) {
  if (checkinStatusSyncInFlight) return false;
  if (isCoolingDown()) return false;
  if (!force && Date.now() - lastCheckinStatusSyncAt < CHECKIN_STATUS_SYNC_THROTTLE_MS) {
    return false;
  }
  return force || getAccounts().some((account) => needsCheckinStatusSync(account) || needsBaseInfoSync(account));
}

function markCheckinQueueItemSigned(account, checkinStats) {
  const item = checkinQueue.items.find((entry) => entry.username === account.username);
  if (!item || !["pending", "failed"].includes(item.status)) return false;

  item.status = "skipped";
  item.message = "今日已签到";
  item.reward = checkinRewardToCurrency(checkinStats.rewardRaw || 0, siteRates);
  usageSyncQueue.priorityUsernames.add(account.username);
  updateCheckinQueueProgressMessage();
  return true;
}

function settleCheckinQueueAfterStatusSync() {
  const progress = getCheckinQueueProgress();
  if (!checkinQueue.items.length || progress.pending > 0) return;

  checkinQueue.status = "completed";
  checkinQueue.currentUsername = null;
  checkinQueue.cooldownUntil = null;
  updateCheckinQueueProgressMessage();
  recordAutoCheckinQueueResult(progress);
  kickUsageSync({
    priorityUsernames: checkinQueue.items.map((item) => item.username)
  });
}

async function syncCheckinStatuses({ force = false } = {}) {
  if (checkinStatusSyncInFlight) return checkinStatusSyncInFlight;
  if (!shouldSyncCheckinStatuses(force)) return null;

  checkinStatusSyncInFlight = Promise.resolve()
    .then(async () => {
      lastCheckinStatusSyncAt = Date.now();
      await fetchSiteStatus();

      const accounts = getAccounts();
      for (let index = 0; index < accounts.length; index += 1) {
        const account = accounts[index];
        if (!force && !needsCheckinStatusSync(account) && !needsBaseInfoSync(account)) {
          continue;
        }

        try {
          await withAccountSession(account, async (session) => {
            let user = null;
            try {
              user = await fetchSelf(session);
            } catch (error) {
              if (error?.code === "AUTH_FAILED" || isRateLimitError(error)) {
                throw error;
              }
              debugLog("base-info-sync-failed", {
                username: account.username,
                status: error?.status || error?.response?.status,
                message: error?.message
              });
            }

            const checkinStats = await fetchTrendCheckinStats(session);
            if (!user && !checkinStats) return;

            updateAccountState(account, (state) => {
              if (user) {
                mergeBaseInfoFromUser(state, user);
              }
              if (checkinStats) {
                applyCheckinStats(state, checkinStats, "remote");
              }
              return state;
            });
            if (checkinStats?.signedToday) {
              markCheckinQueueItemSigned(account, checkinStats);
            }
          });
          clearAuthFailedAlert(account.username);
        } catch (error) {
          if (isRateLimitError(error)) {
            throw error;
          }
          if (error?.code === "AUTH_FAILED") {
            registerAuthFailedAlert(account.username);
          }
          if (isTimeoutError(error)) {
            registerSyncTimeoutAlert(account.username);
          }
          debugLog("checkin-status-sync-failed", {
            username: account.username,
            status: error?.status || error?.response?.status,
            message: error?.message
          });
        }

        if (index < accounts.length - 1) {
          await delay(CHECKIN_STATUS_SYNC_DELAY_MS);
        }
      }

      settleCheckinQueueAfterStatusSync();
      return refreshDashboardSnapshot();
    })
    .finally(() => {
      checkinStatusSyncInFlight = null;
    });

  return checkinStatusSyncInFlight;
}

async function waitForCheckinStatusSync(options = {}) {
  try {
    await syncCheckinStatuses(options);
  } catch (error) {
    debugLog("checkin-status-sync-error", {
      status: error?.status || error?.response?.status,
      message: error?.message
    });
  }
}

function kickCheckinStatusSync(options = {}) {
  void waitForCheckinStatusSync(options);
}

async function runCheckinQueue() {
  if (checkinQueue.running) return;
  if (!checkinQueue.items.length) {
    checkinQueue.status = "completed";
    updateCheckinQueueProgressMessage();
    return;
  }

  if (isCoolingDown()) {
    checkinQueue.status = "cooldown";
    checkinQueue.cooldownUntil = getCooldownUntilIso();
    updateCheckinQueueProgressMessage();
    scheduleCheckinResumeAfterCooldown();
    return;
  }

  checkinQueue.running = true;
  checkinQueue.status = "running";
  updateCheckinQueueProgressMessage();

  try {
    await fetchSiteStatus();
    for (const item of checkinQueue.items) {
      if (item.status !== "pending") continue;
      const account = getAccountByUsername(item.username);
      if (!account) {
        item.status = "failed";
        item.message = "账号不存在";
        continue;
      }

      if (isCoolingDown()) {
        checkinQueue.status = "cooldown";
        checkinQueue.cooldownUntil = getCooldownUntilIso();
        updateCheckinQueueProgressMessage();
        scheduleCheckinResumeAfterCooldown();
        return;
      }

      checkinQueue.currentUsername = item.username;
      updateCheckinQueueProgressMessage();

      try {
        const result = await fastCheckinAccount(account);
        if (result.signedToday) {
          item.status = isAlreadyCheckedMessage(result.message) ? "skipped" : "completed";
          item.message = result.message;
          item.reward = checkinRewardToCurrency(result.rewardRaw || 0, siteRates);
          recordCheckinSuccess(account, result, "remote");
          checkinQueue.lastFailedUsernames.delete(account.username);
          usageSyncQueue.priorityUsernames.add(account.username);
        } else {
          item.status = "failed";
          item.message = result.message || "签到失败";
          recordCheckinFailure(account, item.message);
          checkinQueue.lastFailedUsernames.add(account.username);
        }
        checkinQueue.delayMs = Math.max(
          getCheckinMinDelayMs(),
          checkinQueue.delayMs - getCheckinSuccessStepMs()
        );
      } catch (error) {
        item.attempts += 1;
        if (isRateLimitError(error)) {
          item.message = "站点限流，请稍后重试";
          checkinQueue.status = "cooldown";
          checkinQueue.cooldownUntil = getCooldownUntilIso();
          checkinQueue.autoResume = true;
          updateCheckinQueueProgressMessage();
          scheduleCheckinResumeAfterCooldown();
          return;
        }

        item.status = "failed";
        item.message = error.message || "签到失败";
        recordCheckinFailure(account, item.message);
        checkinQueue.lastFailedUsernames.add(account.username);
        checkinQueue.delayMs = Math.min(
          getCheckinMaxDelayMs(),
          checkinQueue.delayMs + getCheckinFailureStepMs()
        );
      }

      updateCheckinQueueProgressMessage();

      const remainingPending = checkinQueue.items.some((entry) => entry.status === "pending");
      if (remainingPending) {
        await delay(withCheckinDelayJitter(checkinQueue.delayMs));
      }
    }
  } finally {
    checkinQueue.running = false;
    checkinQueue.currentUsername = null;

    const progress = getCheckinQueueProgress();
    if (checkinQueue.items.some((entry) => entry.status === "pending")) {
      if (!isCoolingDown()) {
        checkinQueue.status = "paused";
      }
    } else {
      checkinQueue.status = "completed";
    }

    updateCheckinQueueProgressMessage();
    recordAutoCheckinQueueResult(progress);
    kickUsageSync({
      priorityUsernames: checkinQueue.items.map((item) => item.username)
    });
  }
}

async function runUsageSyncQueue() {
  if (usageSyncQueue.running) return;

  if (!usageSyncQueue.order.length) {
    usageSyncQueue.status = "completed";
    usageSyncQueue.message = "当日用量已同步";
    usageSyncQueue.updatedAt = nowIso();
    return;
  }

  if (checkinQueue.running && hasPendingCheckinItems()) {
    usageSyncQueue.status = "paused";
    usageSyncQueue.message = "签到进行中，统计同步已暂停";
    usageSyncQueue.updatedAt = nowIso();
    return;
  }

  if (isCoolingDown()) {
    usageSyncQueue.status = "cooldown";
    usageSyncQueue.message = cooldownMessage();
    usageSyncQueue.cooldownUntil = getCooldownUntilIso();
    usageSyncQueue.updatedAt = nowIso();
    scheduleUsageResumeAfterCooldown();
    return;
  }

  usageSyncQueue.running = true;
  usageSyncQueue.status = "running";
  usageSyncQueue.message = "后台同步当日用量";
  usageSyncQueue.updatedAt = nowIso();

  try {
    await fetchSiteStatus();
    for (const username of usageSyncQueue.order) {
      if (usageSyncQueue.syncedUsernames.has(username) || usageSyncQueue.failedUsernames.has(username)) {
        continue;
      }

      const account = getAccountByUsername(username);
      if (!account) {
        usageSyncQueue.failedUsernames.add(username);
        continue;
      }

      if (checkinQueue.running && hasPendingCheckinItems()) {
        usageSyncQueue.status = "paused";
        usageSyncQueue.message = "签到进行中，统计同步已暂停";
        usageSyncQueue.updatedAt = nowIso();
        return;
      }

      if (isCoolingDown()) {
        usageSyncQueue.status = "cooldown";
        usageSyncQueue.message = cooldownMessage();
        usageSyncQueue.cooldownUntil = getCooldownUntilIso();
        usageSyncQueue.updatedAt = nowIso();
        scheduleUsageResumeAfterCooldown();
        return;
      }

      usageSyncQueue.currentUsername = username;
      usageSyncQueue.updatedAt = nowIso();

      try {
        await syncAccountUsage(account);
      } catch (error) {
        if (isRateLimitError(error)) {
          markUsageStale(account);
          usageSyncQueue.status = "cooldown";
          usageSyncQueue.message = cooldownMessage();
          usageSyncQueue.cooldownUntil = getCooldownUntilIso();
          usageSyncQueue.updatedAt = nowIso();
          scheduleUsageResumeAfterCooldown();
          return;
        }

        if (error?.code === "AUTH_FAILED") {
          registerAuthFailedAlert(username);
        }
        if (isTimeoutError(error)) {
          registerSyncTimeoutAlert(username);
        }

        usageSyncQueue.failedUsernames.add(username);
        updateAccountState(account, (state) => {
          state.usage.dayKey = currentDayKey();
          state.usage.status = state.usage.updatedAt ? "stale" : "unavailable";
          state.usage.source = state.usage.updatedAt ? "cache" : "pending";
          state.updatedAt = nowIso();
          state.checkin.message =
            state.checkin.status === "unknown" ? "等待同步签到状态" : state.checkin.message;
          return state;
        });
      }

      const hasPending = usageSyncQueue.order.some(
        (candidate) =>
          !usageSyncQueue.syncedUsernames.has(candidate) && !usageSyncQueue.failedUsernames.has(candidate)
      );
      if (hasPending) {
        await delay(getUsageSyncDelayMs());
      }
    }
  } finally {
    usageSyncQueue.running = false;
    usageSyncQueue.currentUsername = null;

    const pendingCount = usageSyncQueue.order.filter(
      (username) =>
        !usageSyncQueue.syncedUsernames.has(username) && !usageSyncQueue.failedUsernames.has(username)
    ).length;

    if (pendingCount === 0) {
      usageSyncQueue.status = "completed";
      usageSyncQueue.message = "当日用量已同步";
      usageSyncQueue.cooldownUntil = null;
    } else if (!isCoolingDown() && (!checkinQueue.running || !hasPendingCheckinItems())) {
      usageSyncQueue.status = "paused";
      usageSyncQueue.message = "当日用量待继续同步";
    }
    usageSyncQueue.updatedAt = nowIso();
  }
}

function buildSummary(accounts) {
  const syncedAccounts = accounts.filter(
    (account) => account.todayUsedStatus === "exact" || account.todayUsedStatus === "stale"
  );

  return {
    todayCheckinIncome: roundMoney(
      accounts.reduce((sum, account) => sum + account.lastCheckinReward, 0)
    ),
    totalBalance: roundMoney(accounts.reduce((sum, account) => sum + account.balance, 0)),
    totalQuota: roundMoney(accounts.reduce((sum, account) => sum + account.totalQuota, 0)),
    todayUsedRawTotal: Math.round(
      syncedAccounts.reduce((sum, account) => sum + (account.todayUsedRaw ?? 0), 0)
    ),
    todayUsed: roundMoney(
      syncedAccounts.reduce((sum, account) => sum + (account.todayUsed ?? 0), 0)
    ),
    todayRemaining: roundMoney(
      accounts.reduce((sum, account) => sum + account.remainingQuota, 0)
    ),
    accountCount: accounts.length,
    checkedInCount: accounts.filter((account) => account.signedToday).length,
    todayUsedCoverage: {
      exactOrStaleAccounts: syncedAccounts.length,
      totalAccounts: accounts.length
    },
    todayRemainingCoverage: {
      exactOrStaleAccounts: accounts.length,
      totalAccounts: accounts.length
    }
  };
}

function buildTrend(accounts) {
  const timeZone = getAppTimeZone();
  const todayParts = getZonedDateParts(new Date(), timeZone);
  const syncedAccounts = accounts.filter(
    (account) => account.todayUsedStatus === "exact" || account.todayUsedStatus === "stale"
  );

  return Array.from({ length: TREND_WINDOW_DAYS }).map((_, index) => {
    const dateParts = getOffsetDayParts(todayParts, index - (TREND_WINDOW_DAYS - 1), timeZone);
    const label = `${dateParts.month}/${dateParts.day}`;
    const dayKey = formatDayKey(dateParts);
    const checkinIncome = getAccounts().reduce((sum, account) => {
      const state = getAccountState(account);
      const records = Array.isArray(state.raw.checkinRecords) ? state.raw.checkinRecords : [];
      const rewardRaw = records
        .filter((record) => record.date === dayKey)
        .reduce((recordSum, record) => recordSum + toNumber(record.quotaAwarded, 0), 0);
      return sum + checkinRewardToCurrency(rewardRaw, siteRates);
    }, 0);

    return {
      date: label,
      checkinIncome: roundMoney(checkinIncome),
      usedQuota:
        index === TREND_WINDOW_DAYS - 1 && syncedAccounts.length
          ? roundMoney(
              syncedAccounts.reduce((sum, account) => sum + (account.todayUsed ?? 0), 0)
            )
          : null
    };
  });
}

function buildDashboardPayload() {
  const accounts = getAllAccountViews();
  return {
    summary: buildSummary(accounts),
    accounts,
    alerts: buildDashboardAlerts(),
    trend: buildTrend(accounts),
    refreshedAt: nowIso(),
    currencySymbol: siteRates.currencySymbol,
    errors: collectDashboardErrors(accounts),
    accountFile: getAccountFilePath(provider.accountsFile),
    provider: {
      id: provider.id,
      label: provider.label,
      baseUrl: provider.baseUrl
    },
    sync: buildSyncState()
  };
}

function refreshDashboardSnapshot(expiresAt = Date.now() + getDashboardCacheTtl()) {
  const payload = buildDashboardPayload();
  dashboardCache = {
    data: payload,
    expiresAt
  };
  return payload;
}

function buildDashboardAlerts() {
  const alerts = [];
  const rateLimitStreak = dashboardAlertsState.rateLimit.streak;
  const authFailedUsernames = Array.from(dashboardAlertsState.authFailed.usernames).sort();
  const syncTimeoutUsernames = Array.from(dashboardAlertsState.syncTimeout.usernames).sort();
  const sessionExpiringUsernames = getSessionExpiringUsernames();

  if (rateLimitStreak >= 2) {
    alerts.push({
      type: "rate_limit",
      severity: "warning",
      title: "连续 429 告警",
      message: `站点已连续 ${rateLimitStreak} 次返回 429，签到与同步队列会进入冷却并自动续跑。`,
      count: rateLimitStreak,
      usernames: [],
      updatedAt: dashboardAlertsState.rateLimit.updatedAt
    });
  }

  if (authFailedUsernames.length) {
    const accounts = getAccounts();
    const linuxDoFailedCount = authFailedUsernames.filter((username) => {
      const account = accounts.find((item) => item.username === username);
      return account && isLinuxDoOAuthAccount(account);
    }).length;
    alerts.push({
      type: "auth_failed",
      severity: "destructive",
      title: "登录失效告警",
      message: linuxDoFailedCount
        ? `${authFailedUsernames.length} 个账号登录态失效；LinuxDo 账号需要重新完成浏览器 OAuth 并导入 MUYUAN session/cookie。`
        : `${authFailedUsernames.length} 个账号登录态失效，请检查账号密码或重新同步。`,
      count: authFailedUsernames.length,
      usernames: authFailedUsernames,
      updatedAt: dashboardAlertsState.authFailed.updatedAt
    });
  }

  if (sessionExpiringUsernames.length) {
    alerts.push({
      type: "session_expiring",
      severity: "warning",
      title: "登录态即将到期",
      message: `${sessionExpiringUsernames.length} 个账号的登录态将在 3 天内到期，建议提前刷新 cookie。`,
      count: sessionExpiringUsernames.length,
      usernames: sessionExpiringUsernames,
      updatedAt: nowIso()
    });
  }

  if (syncTimeoutUsernames.length) {
    alerts.push({
      type: "sync_timeout",
      severity: "warning",
      title: "同步超时告警",
      message: `${syncTimeoutUsernames.length} 个账号在用量同步时超时，建议稍后刷新重试。`,
      count: syncTimeoutUsernames.length,
      usernames: syncTimeoutUsernames,
      updatedAt: dashboardAlertsState.syncTimeout.updatedAt
    });
  }

  return alerts;
}

function getSessionExpiringUsernames() {
  const sessionStore = readSessionStore();
  return getAccounts()
    .filter((account) => hasImportedSessionCredentials(account))
    .filter((account) => getSessionStatus(getAccountSessionExpiresAt(account, sessionStore)) === "expiring")
    .map((account) => account.username)
    .sort();
}

function collectDashboardErrors(accounts) {
  const errors = [];
  const failedAccounts = accounts.filter((account) => account.checkinStatus === "failed");
  for (const account of failedAccounts) {
    errors.push(`${account.username}: ${account.checkinMessage}`);
  }
  if (isCoolingDown()) {
    errors.unshift(cooldownMessage());
  }
  return errors;
}

function canAutoCheckinRunNow(config, store, now = new Date()) {
  if (!config.enabled) return false;
  if (checkinQueue.running || hasPendingCheckinItems()) return false;

  const parts = getZonedDateParts(now, config.timezone);
  const currentClock = formatClock(parts);
  const dueNow = config.catchUpEnabled
    ? currentClock >= config.time
    : currentClock === config.time;

  if (!dueNow) return false;
  if (isAutoCheckinCompletedForDay(formatDayKey(parts))) return false;

  const lastAttemptAt = store.lastAttemptAt ? new Date(store.lastAttemptAt) : null;
  if (
    store.lastErrorMessage &&
    lastAttemptAt &&
    isSameZonedDay(lastAttemptAt, now, config.timezone) &&
    now.getTime() - lastAttemptAt.getTime() < config.retryMinutes * 60 * 1000
  ) {
    return false;
  }

  return true;
}

async function runAutoCheckinTick() {
  if (autoCheckinScheduler.running) return;
  autoCheckinScheduler.running = true;

  try {
    const config = getAutoCheckinConfig();
    const store = autoCheckinScheduler.store;
    const now = new Date();

    if (!canAutoCheckinRunNow(config, store, now)) {
      return;
    }

    const triggeredAt = now.toISOString();
    const todayKey = getDayKeyForDate(now, config.timezone);

    try {
      const result = await startOrResumeCheckinQueue("all");
      const queue = result.sync.checkinQueue;
      const accepted = queue.scope === "all" && queue.progress.total > 0;

      if (!accepted) {
        updateAutoCheckinStore({
          lastAttemptAt: triggeredAt,
          activeDay: null,
          lastErrorMessage: result.message || "自动签到未能启动"
        });
        return;
      }

      updateAutoCheckinStore({
        lastTriggeredAt: triggeredAt,
        lastAttemptAt: triggeredAt,
        lastErrorMessage: null,
        activeDay: todayKey
      });
    } catch (error) {
      updateAutoCheckinStore({
        lastAttemptAt: triggeredAt,
        activeDay: null,
        lastErrorMessage: error?.message || "自动签到触发失败"
      });
    }
  } finally {
    autoCheckinScheduler.running = false;
  }
}

function startAutoCheckinScheduler() {
  autoCheckinScheduler.store = readAutoCheckinStore();
  if (autoCheckinScheduler.timer) return;

  autoCheckinScheduler.timer = setInterval(() => {
    void runAutoCheckinTick();
  }, AUTO_CHECKIN_HEARTBEAT_MS);

  void runAutoCheckinTick();
}

function stopAutoCheckinScheduler() {
  if (autoCheckinScheduler.timer) {
    clearInterval(autoCheckinScheduler.timer);
    autoCheckinScheduler.timer = null;
  }
}

function scheduleBackgroundWork({ force = false, selectedUsername = null, syncCheckinStatus = true } = {}) {
  if (force) {
    clearDashboardCache();

    const accounts = getAccounts();
    for (const account of accounts) {
      const state = getAccountState(account);
      if (state.usage.status === "exact") {
        state.usage.status = "stale";
        state.usage.source = "cache";
        accountStateCache.set(account.key, state);
      }
    }
  }

  if (syncCheckinStatus) {
    kickCheckinStatusSync({ force });
  }
  kickUsageSync({ selectedUsername });
}

async function getDashboard({ force = false, selectedUsername = null } = {}) {
  await fetchSiteStatus();
  if (force) {
    await waitForCheckinStatusSync({ force: true });
  }

  if (!force && dashboardCache && dashboardCache.expiresAt > Date.now()) {
    kickCheckinStatusSync();
    if (selectedUsername) {
      kickUsageSync({ selectedUsername });
    }
    return refreshDashboardSnapshot(dashboardCache.expiresAt);
  }

  if (dashboardInFlight) {
    kickCheckinStatusSync();
    if (selectedUsername) {
      kickUsageSync({ selectedUsername });
    }
    return dashboardInFlight.then(() => refreshDashboardSnapshot());
  }

  dashboardInFlight = Promise.resolve()
    .then(() => {
      scheduleBackgroundWork({ force, selectedUsername, syncCheckinStatus: !force });
      return refreshDashboardSnapshot();
    })
    .finally(() => {
      dashboardInFlight = null;
    });

  return dashboardInFlight;
}

async function checkinAccount(account) {
  await fetchSiteStatus();
  const state = getAccountState(account);

  if (state.checkin.signedToday) {
    return {
      username: account.username,
      displayName: sanitizeDisplayName(state.displayName, account.username),
      signedToday: true,
      reward: state.checkin.reward,
      message: "今日已签到",
      status: "checked",
      updatedAt: nowIso()
    };
  }

  const result = await fastCheckinAccount(account);
  recordCheckinSuccess(account, result, "remote");
  clearDashboardCache();
  kickUsageSync({ priorityUsernames: [account.username], selectedUsername: account.username });

  return {
    username: account.username,
    displayName: sanitizeDisplayName(getAccountState(account).displayName, account.username),
    signedToday: true,
    reward: checkinRewardToCurrency(result.rewardRaw || 0, siteRates),
    message: result.message,
    status: "checked",
    updatedAt: nowIso()
  };
}

async function startOrResumeCheckinQueue(scope = "all") {
  await fetchSiteStatus();
  const queue = ensureCheckinQueue(scope);
  clearDashboardCache();

  let message = scope === "failed" ? "失败账号重试已启动" : "一键签到已启动";
  if (scope === "failed") {
    if (!queue.progress.total) {
      message = "没有可重试的失败账号";
    } else if (!queue.progress.pending && !queue.progress.failed) {
      message = "失败账号已处理完成";
    } else if (queue.status === "cooldown") {
      message = "失败账号重试已加入队列，冷却结束后会自动继续";
    }
  } else if (!queue.progress.total) {
    message = "未读取到可签到账号";
  } else if (!queue.progress.pending && queue.progress.skipped === queue.progress.total) {
    message = "全部账号今日已签到";
  } else if (queue.status === "cooldown") {
    message = "一键签到已加入队列，冷却结束后会自动继续";
  }

  return {
    started: queue.progress.pending > 0,
    scope,
    message,
    sync: buildSyncState()
  };
}


return {
  delay,
  clearDashboardCache,
  isRateLimitError,
  getRequestDelay,
  startAutoCheckinScheduler,
  stopAutoCheckinScheduler,
  getDashboard,
  checkinAccount,
  startOrResumeCheckinQueue,
  applyBrowserSnapshot
};
}

const runtimeCache = new Map();

function getRuntime(providerId = "muyuan") {
  const normalizedProviderId = normalizeProviderId(providerId);
  if (!runtimeCache.has(normalizedProviderId)) {
    runtimeCache.set(normalizedProviderId, createCaowoRuntime(getProviderConfig(normalizedProviderId)));
  }
  return runtimeCache.get(normalizedProviderId);
}

function readProviderId(options = {}) {
  if (typeof options === "string") return options;
  return options?.providerId || options?.provider || "muyuan";
}

export function getQuotaProviders() {
  return {
    defaultProvider: "muyuan",
    providers: getProviderList()
  };
}

export function delay(ms) {
  return getRuntime().delay(ms);
}

export function clearDashboardCache(options = {}) {
  return getRuntime(readProviderId(options)).clearDashboardCache();
}

export function isRateLimitError(error) {
  return getRuntime().isRateLimitError(error);
}

export function getRequestDelay(options = {}) {
  return getRuntime(readProviderId(options)).getRequestDelay();
}

export function startAutoCheckinScheduler() {
  for (const provider of getProviderList()) {
    getRuntime(provider.id).startAutoCheckinScheduler();
  }
}

export function stopAutoCheckinScheduler() {
  for (const provider of getProviderList()) {
    getRuntime(provider.id).stopAutoCheckinScheduler();
  }
}

export async function getDashboard({ providerId = "muyuan", provider = null, force = false, selectedUsername = null } = {}) {
  return getRuntime(provider || providerId).getDashboard({ force, selectedUsername });
}

export async function checkinAccount(account, options = {}) {
  return getRuntime(readProviderId(options)).checkinAccount(account);
}

export async function startOrResumeCheckinQueue(scope = "all", options = {}) {
  return getRuntime(readProviderId(options)).startOrResumeCheckinQueue(scope);
}

export function applyBrowserSnapshot(account, snapshot = {}, options = {}) {
  return getRuntime(readProviderId(options)).applyBrowserSnapshot(account, snapshot);
}
