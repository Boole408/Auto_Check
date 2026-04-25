import crypto from "node:crypto";

const AUTH_COOKIE_NAME = "auto_cw_session";
const DEFAULT_USERNAME = "admin";
const DEFAULT_PASSWORD = "yuqiaa";
const DEFAULT_SESSION_SECRET = "auto-cw-session-secret";
const DEFAULT_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const activeSessionIds = new Map();
const PRODUCTION_PASSWORD_PLACEHOLDERS = new Set([DEFAULT_PASSWORD, "change-this-login-password"]);
const PRODUCTION_SECRET_PLACEHOLDERS = new Set([
  DEFAULT_SESSION_SECRET,
  "change-this-session-secret"
]);

function isProduction() {
  return process.env.NODE_ENV === "production";
}

function getConfiguredUsername() {
  return process.env.APP_LOGIN_USERNAME || DEFAULT_USERNAME;
}

function getConfiguredPassword() {
  return process.env.APP_LOGIN_PASSWORD || DEFAULT_PASSWORD;
}

function getSessionSecret() {
  return process.env.APP_LOGIN_SESSION_SECRET || DEFAULT_SESSION_SECRET;
}

function getSessionTtlMs() {
  const value = Number(process.env.APP_LOGIN_SESSION_TTL_MS);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_SESSION_TTL_MS;
}

function base64UrlEncode(value) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function base64UrlDecode(value) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function signPayload(payload) {
  return crypto.createHmac("sha256", getSessionSecret()).update(payload).digest("base64url");
}

function safeCompare(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function parseCookies(header = "") {
  return String(header)
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .reduce((cookies, entry) => {
      const separatorIndex = entry.indexOf("=");
      if (separatorIndex === -1) return cookies;
      const key = entry.slice(0, separatorIndex).trim();
      const value = entry.slice(separatorIndex + 1).trim();
      cookies[key] = decodeURIComponent(value);
      return cookies;
    }, {});
}

function serializeSession(username, expiresAt) {
  return {
    authenticated: true,
    username,
    expiresAt: new Date(expiresAt).toISOString()
  };
}

export function getAuthConfig() {
  return {
    username: getConfiguredUsername(),
    sessionTtlMs: getSessionTtlMs()
  };
}

export function assertAuthConfig() {
  if (!isProduction()) {
    return;
  }

  const password = String(process.env.APP_LOGIN_PASSWORD || "").trim();
  const sessionSecret = String(process.env.APP_LOGIN_SESSION_SECRET || "").trim();

  if (!password || PRODUCTION_PASSWORD_PLACEHOLDERS.has(password)) {
    throw new Error("APP_LOGIN_PASSWORD must be set to a non-default value in production");
  }

  if (!sessionSecret || PRODUCTION_SECRET_PLACEHOLDERS.has(sessionSecret)) {
    throw new Error("APP_LOGIN_SESSION_SECRET must be set to a non-default value in production");
  }
}

export function createSessionToken(username = getConfiguredUsername()) {
  const sessionId = crypto.randomUUID();
  activeSessionIds.set(username, sessionId);

  const payload = base64UrlEncode(
    JSON.stringify({
      username,
      sessionId,
      expiresAt: Date.now() + getSessionTtlMs()
    })
  );

  return `${payload}.${signPayload(payload)}`;
}

export function verifySessionToken(token) {
  if (!token || typeof token !== "string") {
    return null;
  }

  const [payload, signature] = token.split(".");
  if (!payload || !signature) {
    return null;
  }

  const expectedSignature = signPayload(payload);
  if (!safeCompare(signature, expectedSignature)) {
    return null;
  }

  try {
    const session = JSON.parse(base64UrlDecode(payload));
    if (!session?.username || !session?.expiresAt || !session?.sessionId) {
      return null;
    }

    if (session.username !== getConfiguredUsername()) {
      return null;
    }

    if (Number(session.expiresAt) <= Date.now()) {
      activeSessionIds.delete(session.username);
      return null;
    }

    if (activeSessionIds.get(session.username) !== session.sessionId) {
      return null;
    }

    return serializeSession(session.username, session.expiresAt);
  } catch {
    return null;
  }
}

export function getSessionFromRequest(req) {
  const cookies = parseCookies(req.headers.cookie);
  return verifySessionToken(cookies[AUTH_COOKIE_NAME]);
}

export function setSessionCookie(res, username = getConfiguredUsername()) {
  res.cookie(AUTH_COOKIE_NAME, createSessionToken(username), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: getSessionTtlMs(),
    path: "/"
  });
}

export function clearSessionCookie(res) {
  res.clearCookie(AUTH_COOKIE_NAME, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/"
  });
}

export function clearActiveSession(username = getConfiguredUsername()) {
  activeSessionIds.delete(username);
}

export function isValidPassword(password) {
  return safeCompare(password, getConfiguredPassword());
}

export function requireAuth(req, res, next) {
  const session = getSessionFromRequest(req);

  if (!session) {
    res.status(401).json({
      success: false,
      message: "登录状态已失效，请重新登录",
      data: null
    });
    return;
  }

  req.auth = session;
  next();
}
