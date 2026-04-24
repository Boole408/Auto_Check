import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import axios from "axios";
import dotenv from "dotenv";
import { getAccountFilePath, loadAccounts } from "./accountLoader.js";

dotenv.config();

const DEFAULT_QUOTA_PER_UNIT = 500000;
const DEFAULT_USD_EXCHANGE_RATE = 1;
const DEFAULT_CUSTOM_CURRENCY_EXCHANGE_RATE = 1;
const DEFAULT_CURRENCY_SYMBOL = "¥";
const DEFAULT_DASHBOARD_CACHE_TTL = 10_000;
const DEFAULT_SESSION_TTL = 6 * 60 * 60 * 1000;
const DEFAULT_RATE_LIMIT_COOLDOWN = 180_000;
const DEFAULT_USAGE_SYNC_DELAY = 4_000;
const DEFAULT_TIMEOUT = 15_000;
const DEFAULT_APP_TIMEZONE = "Asia/Shanghai";
const DEFAULT_AUTO_CHECKIN_TIME = "00:01";
const DEFAULT_AUTO_CHECKIN_RETRY_MINUTES = 10;
const AUTO_CHECKIN_HEARTBEAT_MS = 30_000;

const CHECKIN_INITIAL_DELAY = 2_500;
const CHECKIN_SUCCESS_STEP = 250;
const CHECKIN_FAILURE_STEP = 1_000;
const CHECKIN_MIN_DELAY = 1_500;
const CHECKIN_MAX_DELAY = 10_000;

const CHECKIN_STATUSES = new Set(["checked", "unchecked", "failed", "unknown"]);
const TODAY_USED_STATUSES = new Set(["exact", "stale", "pending", "unavailable"]);

const baseURL = process.env.CAOWO_BASE_URL || "https://caowo.xin";
const client = axios.create({
  baseURL,
  timeout: Number(process.env.CAOWO_TIMEOUT_MS || DEFAULT_TIMEOUT),
  headers: {
    Accept: "application/json",
    "Content-Type": "application/json",
    "User-Agent": "CW-Ops/1.0"
  },
  validateStatus: (status) => status < 500
});

const sessionCache = new Map();
const accountStateCache = new Map();
let dashboardCache = null;
let dashboardInFlight = null;
let siteRates = {
  quotaPerUnit: DEFAULT_QUOTA_PER_UNIT,
  usdExchangeRate: DEFAULT_USD_EXCHANGE_RATE,
  customCurrencyExchangeRate: DEFAULT_CUSTOM_CURRENCY_EXCHANGE_RATE,
  currencySymbol: DEFAULT_CURRENCY_SYMBOL
};
let siteRatesExpiresAt = 0;
let rateLimitUntil = 0;

const checkinQueue = createCheckinQueueState();
const usageSyncQueue = createUsageSyncQueueState();
const dashboardAlertsState = createDashboardAlertsState();
const autoCheckinScheduler = createAutoCheckinSchedulerState();

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
    delayMs: CHECKIN_INITIAL_DELAY,
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
    lastErrorMessage: null
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
  if (process.env.CAOWO_DEBUG === "1") {
    console.warn(`[caowo-debug] ${message}`, JSON.stringify(payload));
  }
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
  const configured = process.env.CAOWO_AUTO_CHECKIN_TZ || DEFAULT_APP_TIMEZONE;
  return isValidTimeZone(configured) ? configured : DEFAULT_APP_TIMEZONE;
}

function getAutoCheckinConfig() {
  return {
    enabled: getBooleanEnv("CAOWO_AUTO_CHECKIN_ENABLED", true),
    time: normalizeAutoCheckinTime(process.env.CAOWO_AUTO_CHECKIN_TIME),
    timezone: getAppTimeZone(),
    catchUpEnabled: getBooleanEnv("CAOWO_AUTO_CHECKIN_CATCH_UP", true),
    retryMinutes: Math.max(
      1,
      getNumberEnv("CAOWO_AUTO_CHECKIN_RETRY_MINUTES", DEFAULT_AUTO_CHECKIN_RETRY_MINUTES)
    )
  };
}

function getDashboardCacheTtl() {
  return getNumberEnv("CAOWO_CACHE_TTL_MS", DEFAULT_DASHBOARD_CACHE_TTL);
}

function getRateLimitCooldownMs() {
  return getNumberEnv("CAOWO_RATE_LIMIT_COOLDOWN_MS", DEFAULT_RATE_LIMIT_COOLDOWN);
}

function getUsageSyncDelayMs() {
  return getNumberEnv("CAOWO_USAGE_SYNC_DELAY_MS", DEFAULT_USAGE_SYNC_DELAY);
}

function getSessionStorePath() {
  return path.resolve(process.cwd(), ".cache", "caowo-sessions.json");
}

function getAutoCheckinStorePath() {
  return path.resolve(process.cwd(), ".cache", "caowo-auto-checkin.json");
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

function passwordHash(password) {
  return crypto.createHash("sha256").update(String(password)).digest("hex");
}

function accountCacheKey(account) {
  return `${account.username}:${passwordHash(account.password)}`;
}

function sessionCacheKey(account) {
  return `${account.username}:${passwordHash(account.password)}`;
}

function hasSessionAuth(session) {
  return Boolean(session?.token || session?.cookie);
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
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return {};
  }
}

function writeSessionStore(store) {
  try {
    const filePath = getSessionStorePath();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(store, null, 2), "utf8");
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
    fs.writeFileSync(filePath, JSON.stringify(store, null, 2), "utf8");
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

  if (store.lastTriggeredDay === todayKey) {
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
  if (!payload || typeof payload !== "object") return true;
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
  const setCookie = headers?.["set-cookie"];
  if (!setCookie) return "";
  return setCookie.map((item) => item.split(";")[0]).join("; ");
}

function sessionHeaders(session) {
  const headers = {
    "New-API-User": String(session.userId || session.username)
  };

  if (session.token) {
    headers.Authorization = session.token.startsWith("Bearer ")
      ? session.token
      : `Bearer ${session.token}`;
    headers["New-API-Token"] = session.token;
  }

  if (session.cookie) {
    headers.Cookie = session.cookie;
  }

  return headers;
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

export function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function clearDashboardCache() {
  dashboardCache = null;
  dashboardInFlight = null;
}

export function isRateLimitError(error) {
  return (
    error?.status === 429 ||
    error?.response?.status === 429 ||
    /429|too many|rate limit|限流|请求过于频繁/i.test(error?.message || "")
  );
}

export function getRequestDelay() {
  return getUsageSyncDelayMs();
}

class CaowoError extends Error {
  constructor(message, status = 500, code = "CAOWO_ERROR", details = null) {
    super(message);
    this.name = "CaowoError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function getAccounts() {
  return loadAccounts().map((account) => ({
    ...account,
    key: accountCacheKey(account)
  }));
}

function getAccountByUsername(username) {
  return getAccounts().find((account) => account.username === username) || null;
}

function quotaToCurrency(rawQuota, rates = siteRates) {
  const quota = toNumber(rawQuota, 0);
  return roundMoney(
    (quota / rates.quotaPerUnit) *
      rates.usdExchangeRate *
      rates.customCurrencyExchangeRate
  );
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
  return {
    username: account.username,
    displayName: account.username,
    balance: 0,
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

function markTodayUsedPending(account, message = "待同步当日用量") {
  updateAccountState(account, (state) => {
    state.usage.status = state.usage.updatedAt ? "stale" : "pending";
    state.usage.source = state.usage.updatedAt ? "cache" : "pending";
    state.checkin.message =
      state.checkin.status === "unknown" ? "等待同步签到状态" : state.checkin.message;
    state.updatedAt = nowIso();
    if (!state.usage.updatedAt) {
      state.usage.value = null;
    }
    if (message && state.usage.status === "pending") {
      state.usage.note = message;
    }
    return state;
  });
}

function buildAccountView(state) {
  const todayUsedValue = state.usage.value;
  const totalQuota =
    state.totalQuota > 0
      ? state.totalQuota
      : roundMoney(state.balance + (todayUsedValue ?? 0));
  const remainingQuota =
    todayUsedValue == null ? totalQuota : roundMoney(Math.max(totalQuota - todayUsedValue, 0));
  const usagePercent =
    todayUsedValue == null || totalQuota <= 0
      ? 0
      : Math.round((todayUsedValue / totalQuota) * 1000) / 10;

  return {
    username: state.username,
    displayName: state.displayName,
    signedToday: state.checkin.signedToday,
    checkinStatus: CHECKIN_STATUSES.has(state.checkin.status) ? state.checkin.status : "unknown",
    checkinMessage: state.checkin.message,
    todayUsed: todayUsedValue,
    todayUsedStatus: TODAY_USED_STATUSES.has(state.usage.status) ? state.usage.status : "pending",
    todayUsedUpdatedAt: state.usage.updatedAt,
    totalQuota,
    remainingQuota,
    balance: state.balance,
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
  return getAccounts().map((account) => buildAccountView(getAccountState(account)));
}

function normalizeRates(payload = {}) {
  const data = unwrap(payload) || {};
  const quotaPerUnit = toNumber(
    readPath(data, ["quota_per_unit", "quotaPerUnit", "quota.unit", "settings.quota_per_unit"]),
    DEFAULT_QUOTA_PER_UNIT
  );

  return {
    quotaPerUnit: quotaPerUnit > 0 ? quotaPerUnit : DEFAULT_QUOTA_PER_UNIT,
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
      readPath(data, [
        "custom_currency_symbol",
        "currency_symbol",
        "currencySymbol",
        "settings.custom_currency_symbol"
      ]) || DEFAULT_CURRENCY_SYMBOL
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

async function loginAccount(account, { force = false } = {}) {
  const key = sessionCacheKey(account);
  const cached = sessionCache.get(key);
  if (!force && cached && hasSessionAuth(cached) && cached.expiresAt > Date.now()) {
    return cached;
  }

  const persisted = readSessionStore()[key];
  if (!force && persisted && hasSessionAuth(persisted) && persisted.expiresAt > Date.now()) {
    sessionCache.set(key, persisted);
    return persisted;
  }

  if (isCoolingDown()) {
    throw new CaowoError(cooldownMessage(), 429, "RATE_LIMIT_COOLDOWN");
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
    readPath(data, ["id", "user_id", "userId", "user.id", "user.user_id"]) || account.username;
  const displayName =
    readPath(user, ["display_name", "displayName", "nickname", "name", "username"]) ||
    account.username;

  const session = {
    username: account.username,
    displayName: String(displayName),
    userId,
    token: token ? String(token) : "",
    cookie: extractCookie(response.headers),
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
    const response = await client.get(endpoint, { headers: sessionHeaders(session) });
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
  const todayRecord = records.find((record) => String(record.checkin_date || "") === today);
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
      date: String(record.checkin_date || ""),
      quotaAwarded: toNumber(record.quota_awarded, 0)
    }))
  };
}

async function fetchCheckinStats(session) {
  const response = await client.get(`/api/user/checkin?month=${currentMonthKey()}`, {
    headers: sessionHeaders(session)
  });

  debugLog("checkin-status", {
    username: session.username,
    status: response.status,
    success: response.data?.success,
    message: response.data?.message,
    checkedInToday: response.data?.data?.stats?.checked_in_today
  });

  if (response.status === 401 || response.status === 403) {
    throw new CaowoError("登录已失效，请重新同步", response.status, "AUTH_FAILED");
  }
  if ([400, 404, 405].includes(response.status)) {
    return null;
  }

  assertHttpOk(response, "读取签到状态");
  if (!isSuccessEnvelope(response.data)) {
    return null;
  }

  return normalizeCheckinStats(response.data);
}

function sumArrayQuota(rows) {
  if (!Array.isArray(rows)) return 0;
  return rows.reduce((sum, row) => {
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
    return sum + toNumber(raw, 0);
  }, 0);
}

function normalizeUsageStats(payload = {}) {
  const data = unwrap(payload) || {};
  const rows = Array.isArray(data) ? data : data.items || data.logs || data.records || data.data;
  const directValue = toNumber(
    readPath(data, [
      "quota",
      "today_used_quota",
      "todayUsedQuota",
      "today_used",
      "used_quota_today",
      "usedQuota",
      "used_quota",
      "quota_today",
      "usage_quota",
      "consume_quota",
      "amount"
    ]),
    NaN
  );

  if (Number.isFinite(directValue)) {
    return { todayUsedRaw: directValue };
  }

  return { todayUsedRaw: sumArrayQuota(rows) };
}

async function fetchTodayUsageStats(session) {
  const { start, end } = todayRangeSeconds();
  const endpoints = [
    `/api/log/self/stat?type=0&start_timestamp=${start}&end_timestamp=${end}`,
    `/api/log/self/stat?start_timestamp=${start}&end_timestamp=${end}`,
    `/api/log/stat/self?type=0&start_timestamp=${start}&end_timestamp=${end}`,
    `/api/data/self?start_timestamp=${start}&end_timestamp=${end}`,
    `/api/user/usage?start_timestamp=${start}&end_timestamp=${end}`
  ];

  for (const endpoint of endpoints) {
    const response = await client.get(endpoint, { headers: sessionHeaders(session) });
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
  const displayName =
    String(readPath(user, ["display_name", "displayName", "nickname", "name", "username"]) || "") ||
    state.displayName ||
    state.username;

  state.displayName = displayName;
  state.balance = quotaToCurrency(rawBalance, siteRates);
  state.totalQuota = rawTotal > 0 ? quotaToCurrency(rawTotal, siteRates) : state.balance;
  state.remainingQuota = state.balance;
  state.currencySymbol = siteRates.currencySymbol;
  state.updatedAt = nowIso();
  state.lastRemoteSyncAt = nowIso();
  state.raw.balance = rawBalance;
  state.raw.totalQuota = rawTotal;
  state.raw.remainingQuota = rawBalance;
  return state;
}

function applyCheckinStats(state, checkinStats, source = "remote") {
  if (!checkinStats) return state;
  state.checkin.dayKey = currentDayKey();
  state.checkin.signedToday = Boolean(checkinStats.signedToday);
  state.checkin.status = checkinStats.signedToday ? "checked" : "unchecked";
  state.checkin.message = checkinStats.signedToday ? "今日已签到" : "待签到";
  state.checkin.reward = quotaToCurrency(checkinStats.rewardRaw, siteRates);
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

function markUsageStale(account) {
  updateAccountState(account, (state) => {
    state.usage.dayKey = currentDayKey();
    state.usage.status = state.usage.updatedAt ? "stale" : "pending";
    state.usage.source = state.usage.updatedAt ? "cache" : "pending";
    state.updatedAt = nowIso();
    return state;
  });
}

async function syncCheckinStatusOnly(account) {
  if (isCoolingDown()) {
    throw new CaowoError(cooldownMessage(), 429, "RATE_LIMIT_COOLDOWN");
  }

  await fetchSiteStatus();
  return withAccountSession(account, async (session) => {
    const checkinStats = await fetchCheckinStats(session);
    updateAccountState(account, (state) => {
      if (session.displayName) state.displayName = session.displayName;
      state.currencySymbol = siteRates.currencySymbol;
      if (checkinStats) {
        applyCheckinStats(state, checkinStats, "remote");
      } else if (state.checkin.status === "unknown") {
        state.checkin.message = "等待同步签到状态";
      }
      state.updatedAt = nowIso();
      return state;
    });
    return getAccountState(account);
  });
}

async function syncAccountUsage(account) {
  if (isCoolingDown()) {
    throw new CaowoError(cooldownMessage(), 429, "RATE_LIMIT_COOLDOWN");
  }

  await fetchSiteStatus();
  return withAccountSession(account, async (session) => {
    const user = await fetchSelf(session);
    const checkinStats = await fetchCheckinStats(session);
    const usageStats = await fetchTodayUsageStats(session);

    updateAccountState(account, (state) => {
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
  return toNumber(
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
    if (store.lastTriggeredDay === todayKey) {
      if (checkinQueue.status === "cooldown") status = "cooldown";
      else if (checkinQueue.running || checkinQueue.status === "running") status = "running";
      else status = "triggered";
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
  checkinQueue.delayMs = CHECKIN_INITIAL_DELAY;
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
    const response = await client.post("/api/user/checkin", null, {
      headers: sessionHeaders(session)
    });

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
      result.rewardRaw > 0 ? quotaToCurrency(result.rewardRaw, siteRates) : state.checkin.reward;
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
          item.reward = quotaToCurrency(result.rewardRaw || 0, siteRates);
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
          CHECKIN_MIN_DELAY,
          checkinQueue.delayMs - CHECKIN_SUCCESS_STEP
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
          CHECKIN_MAX_DELAY,
          checkinQueue.delayMs + CHECKIN_FAILURE_STEP
        );
      }

      updateCheckinQueueProgressMessage();

      const remainingPending = checkinQueue.items.some((entry) => entry.status === "pending");
      if (remainingPending) {
        await delay(checkinQueue.delayMs);
      }
    }
  } finally {
    checkinQueue.running = false;
    checkinQueue.currentUsername = null;

    if (checkinQueue.items.some((entry) => entry.status === "pending")) {
      if (!isCoolingDown()) {
        checkinQueue.status = "paused";
      }
    } else {
      checkinQueue.status = "completed";
    }

    updateCheckinQueueProgressMessage();
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

  if (checkinQueue.running) {
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

      if (checkinQueue.running) {
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
    } else if (!isCoolingDown() && !checkinQueue.running) {
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
    todayUsed: roundMoney(
      syncedAccounts.reduce((sum, account) => sum + (account.todayUsed ?? 0), 0)
    ),
    todayRemaining: roundMoney(
      syncedAccounts.reduce((sum, account) => sum + account.remainingQuota, 0)
    ),
    accountCount: accounts.length,
    checkedInCount: accounts.filter((account) => account.signedToday).length,
    todayUsedCoverage: {
      exactOrStaleAccounts: syncedAccounts.length,
      totalAccounts: accounts.length
    },
    todayRemainingCoverage: {
      exactOrStaleAccounts: syncedAccounts.length,
      totalAccounts: accounts.length
    }
  };
}

function buildTrend(accounts) {
  const timeZone = getAppTimeZone();
  const todayParts = getZonedDateParts(new Date(), timeZone);
  return Array.from({ length: 7 }).map((_, index) => {
    const dateParts = getOffsetDayParts(todayParts, index - 6, timeZone);
    const label = `${dateParts.month}/${dateParts.day}`;
    const dayKey = formatDayKey(dateParts);
    const checkinIncome = getAccounts().reduce((sum, account) => {
      const state = getAccountState(account);
      const records = Array.isArray(state.raw.checkinRecords) ? state.raw.checkinRecords : [];
      const rewardRaw = records
        .filter((record) => record.date === dayKey)
        .reduce((recordSum, record) => recordSum + toNumber(record.quotaAwarded, 0), 0);
      return sum + quotaToCurrency(rewardRaw, siteRates);
    }, 0);

    return {
      date: label,
      checkinIncome: roundMoney(checkinIncome),
      usedQuota:
        index === 6
          ? roundMoney(
              accounts.reduce((sum, account) => sum + (account.todayUsed ?? 0), 0)
            )
          : 0
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
    accountFile: getAccountFilePath(),
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
    alerts.push({
      type: "auth_failed",
      severity: "destructive",
      title: "登录失效告警",
      message: `${authFailedUsernames.length} 个账号登录态失效，请检查账号密码或重新同步。`,
      count: authFailedUsernames.length,
      usernames: authFailedUsernames,
      updatedAt: dashboardAlertsState.authFailed.updatedAt
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

  const parts = getZonedDateParts(now, config.timezone);
  const currentClock = formatClock(parts);
  const dueNow = config.catchUpEnabled
    ? currentClock >= config.time
    : currentClock === config.time;

  if (!dueNow) return false;
  if (store.lastTriggeredDay === formatDayKey(parts)) return false;

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
          lastErrorMessage: result.message || "自动签到未能启动"
        });
        return;
      }

      updateAutoCheckinStore({
        lastTriggeredDay: todayKey,
        lastTriggeredAt: triggeredAt,
        lastAttemptAt: triggeredAt,
        lastErrorMessage: null
      });
    } catch (error) {
      updateAutoCheckinStore({
        lastAttemptAt: triggeredAt,
        lastErrorMessage: error?.message || "自动签到触发失败"
      });
    }
  } finally {
    autoCheckinScheduler.running = false;
  }
}

export function startAutoCheckinScheduler() {
  autoCheckinScheduler.store = readAutoCheckinStore();
  if (autoCheckinScheduler.timer) return;

  autoCheckinScheduler.timer = setInterval(() => {
    void runAutoCheckinTick();
  }, AUTO_CHECKIN_HEARTBEAT_MS);

  void runAutoCheckinTick();
}

export function stopAutoCheckinScheduler() {
  if (autoCheckinScheduler.timer) {
    clearInterval(autoCheckinScheduler.timer);
    autoCheckinScheduler.timer = null;
  }
}

function scheduleBackgroundWork({ force = false, selectedUsername = null } = {}) {
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

  kickUsageSync({ selectedUsername });
}

export async function getDashboard({ force = false, selectedUsername = null } = {}) {
  await fetchSiteStatus();

  if (!force && dashboardCache && dashboardCache.expiresAt > Date.now()) {
    if (selectedUsername) {
      kickUsageSync({ selectedUsername });
    }
    return refreshDashboardSnapshot(dashboardCache.expiresAt);
  }

  if (dashboardInFlight) {
    if (selectedUsername) {
      kickUsageSync({ selectedUsername });
    }
    return dashboardInFlight.then(() => refreshDashboardSnapshot());
  }

  dashboardInFlight = Promise.resolve()
    .then(() => {
      scheduleBackgroundWork({ force, selectedUsername });
      return refreshDashboardSnapshot();
    })
    .finally(() => {
      dashboardInFlight = null;
    });

  return dashboardInFlight;
}

export async function checkinAccount(account) {
  await fetchSiteStatus();
  const state = getAccountState(account);

  if (state.checkin.signedToday) {
    return {
      username: account.username,
      displayName: state.displayName,
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
    displayName: getAccountState(account).displayName,
    signedToday: true,
    reward: quotaToCurrency(result.rewardRaw || 0, siteRates),
    message: result.message,
    status: "checked",
    updatedAt: nowIso()
  };
}

export async function startOrResumeCheckinQueue(scope = "all") {
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
