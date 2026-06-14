import fs from "node:fs";
import path from "node:path";

const FIELD_ALIASES = {
  username: "username",
  user: "username",
  account: "username",
  name: "username",
  email: "username",
  "账号": "username",
  "用户名": "username",
  "账户": "username",
  password: "password",
  pass: "password",
  pwd: "password",
  "密码": "password",
  token: "token",
  access_token: "token",
  accesstoken: "token",
  api_token: "token",
  apitoken: "token",
  bearer: "token",
  jwt: "token",
  "令牌": "token",
  cookie: "cookie",
  cookies: "cookie",
  session_cookie: "cookie",
  sessioncookie: "cookie",
  "登录态": "cookie",
  userid: "userId",
  user_id: "userId",
  id: "userId",
  uid: "userId",
  displayname: "displayName",
  display_name: "displayName",
  nickname: "displayName",
  expiresat: "expiresAt",
  expires_at: "expiresAt",
  expire_at: "expiresAt"
};

function getDefaultAccountFile() {
  return path.resolve(process.cwd(), "accounts.txt");
}

export function getAccountFilePath(accountFile = null) {
  return (
    accountFile ||
    process.env.MUYUAN_ACCOUNTS_FILE ||
    process.env.CAOWO_ACCOUNTS_FILE ||
    getDefaultAccountFile()
  );
}

function cleanValue(value = "") {
  return String(value).replace(/^\uFEFF/, "").trim().replace(/^["']|["']$/g, "");
}

function cleanToken(value = "") {
  return cleanValue(value).replace(/^Bearer\s+/i, "");
}

function normalizeDelimitedLine(line) {
  return String(line)
    .replace(/^\uFEFF/, "")
    .replace(/，/g, ",")
    .replace(/；/g, ";")
    .replace(/：/g, ":")
    .trim();
}

function normalizeFieldName(field = "") {
  return String(field).trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function canonicalFieldName(field = "") {
  return FIELD_ALIASES[normalizeFieldName(field)] || "";
}

function splitDelimitedLine(line) {
  const normalized = normalizeDelimitedLine(line);
  const delimiter = normalized.includes("\t")
    ? "\t"
    : normalized.includes(",")
      ? ","
      : normalized.includes(";")
        ? ";"
        : " ";
  const parts = [];
  let current = "";
  let quote = "";

  for (const char of normalized) {
    if ((char === '"' || char === "'") && (!quote || quote === char)) {
      quote = quote ? "" : char;
      current += char;
      continue;
    }

    const isDelimiter =
      !quote &&
      (delimiter === " " ? /\s/.test(char) : char === delimiter);

    if (isDelimiter) {
      const value = cleanValue(current);
      if (value) parts.push(value);
      current = "";
      continue;
    }

    current += char;
  }

  const value = cleanValue(current);
  if (value) parts.push(value);
  return parts;
}

function isHeaderRow(parts = []) {
  if (parts.length < 2) return false;
  const canonicalFields = parts.map(canonicalFieldName);
  return canonicalFields.includes("username") && canonicalFields.some((field) => field !== "");
}

function recordFromHeader(parts, header) {
  const record = {};
  header.forEach((field, index) => {
    const canonical = canonicalFieldName(field);
    if (canonical && parts[index] != null) {
      record[canonical] = parts[index];
    }
  });
  return normalizeAccountRecord(record);
}

function readObjectPath(object, paths) {
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

function tryParseJson(value) {
  try {
    return JSON.parse(String(value));
  } catch {
    return null;
  }
}

function parseEmbeddedJsonLine(line) {
  const source = String(line || "").trim();
  const jsonStart = source.search(/[\[{]/);
  if (jsonStart === -1) return null;

  const parsed = tryParseJson(source.slice(jsonStart));
  if (!parsed) return null;

  if (Array.isArray(parsed)) {
    return normalizeAccountRecord(parsed[0]);
  }

  return normalizeAccountRecord(parsed);
}

function collectKeyValueFields(line) {
  const normalized = normalizeDelimitedLine(line).replace(/\s+/g, " ");
  const fields = [];
  const fieldPattern =
    /(?:^|,\s*)(账号|用户名|账户|密码|令牌|登录态|username|user|account|name|email|password|pass|pwd|token|access_token|accessToken|api_token|apiToken|bearer|jwt|cookie|cookies|session_cookie|sessionCookie|userId|user_id|id|uid|displayName|display_name|nickname|expiresAt|expires_at)\s*[:=]\s*/gi;
  let match;

  while ((match = fieldPattern.exec(normalized))) {
    fields.push({
      key: canonicalFieldName(match[1]),
      start: fieldPattern.lastIndex,
      matchStart: match.index
    });
  }

  if (!fields.length) return null;

  const record = {};
  fields.forEach((field, index) => {
    if (!field.key) return;
    const end = fields[index + 1]?.matchStart ?? normalized.length;
    record[field.key] = cleanValue(normalized.slice(field.start, end).replace(/,\s*$/, ""));
  });

  return normalizeAccountRecord(record);
}

function parseKeyValueLine(line) {
  return parseEmbeddedJsonLine(line) || collectKeyValueFields(line);
}

function hasKnownFieldAssignment(part) {
  const match = String(part).match(/^([\w\u4e00-\u9fa5-]+)\s*[:=]/);
  return Boolean(match && canonicalFieldName(match[1]));
}

function parseCsvLine(line) {
  const parts = splitDelimitedLine(line);
  if (parts.length < 2) return null;
  if (isHeaderRow(parts)) return null;

  if (parts.slice(1).some((part) => hasKnownFieldAssignment(part))) {
    return parseKeyValueLine(`username:${parts[0]}, ${parts.slice(1).join(",")}`);
  }

  return normalizeAccountRecord({
    username: parts[0],
    password: parts.slice(1).join(",")
  });
}

function normalizeAccountRecord(record) {
  if (!record) return null;

  if (typeof record === "string") {
    return parseKeyValueLine(record) || parseCsvLine(record);
  }

  if (Array.isArray(record)) {
    if (record.length < 2) return null;
    return normalizeAccountRecord({
      username: record[0],
      password: record.slice(1).join(",")
    });
  }

  if (typeof record === "object") {
    const username = cleanValue(
      readObjectPath(record, [
        "username",
        "user.username",
        "user.email",
        "user.name",
        "user.id",
        "user",
        "account",
        "email",
        "name",
        "账号",
        "用户名",
        "账户",
        "id"
      ])
    );
    const password = cleanValue(
      readObjectPath(record, ["password", "pass", "pwd", "密码"])
    );
    const token = cleanToken(
      readObjectPath(record, [
        "token",
        "access_token",
        "accessToken",
        "api_token",
        "apiToken",
        "bearer",
        "jwt",
        "令牌",
        "user.token",
        "user.access_token",
        "session.token"
      ])
    );
    const cookie = cleanValue(
      readObjectPath(record, [
        "cookie",
        "cookies",
        "session_cookie",
        "sessionCookie",
        "登录态"
      ])
    );
    const userId = cleanValue(
      readObjectPath(record, ["userId", "user_id", "id", "uid", "user.id"])
    );
    const displayName = cleanValue(
      readObjectPath(record, [
        "displayName",
        "display_name",
        "nickname",
        "user.displayName",
        "user.display_name",
        "user.nickname",
        "user.name"
      ])
    );
    const expiresAt = cleanValue(readObjectPath(record, ["expiresAt", "expires_at", "expire_at"]));

    if (!username || (!password && !token && !cookie)) return null;

    return {
      username,
      ...(password ? { password } : {}),
      ...(token ? { token } : {}),
      ...(cookie ? { cookie } : {}),
      ...(userId ? { userId } : {}),
      ...(displayName ? { displayName } : {}),
      ...(expiresAt ? { expiresAt } : {})
    };
  }

  return null;
}

function dedupeAccounts(accounts) {
  const seen = new Set();

  return accounts.filter((account) => {
    if (!account?.username || (!account.password && !account.token && !account.cookie)) return false;
    if (seen.has(account.username)) return false;
    seen.add(account.username);
    return true;
  });
}

function parseTextAccounts(content) {
  const lines = String(content)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && !line.startsWith("//"));

  if (!lines.length) return [];

  const header = splitDelimitedLine(lines[0]);
  if (isHeaderRow(header)) {
    return dedupeAccounts(
      lines
        .slice(1)
        .map((line) => recordFromHeader(splitDelimitedLine(line), header))
        .filter(Boolean)
    );
  }

  return dedupeAccounts(
    lines
      .map((line) => parseKeyValueLine(line) || parseCsvLine(line))
      .filter(Boolean)
  );
}

function parseJsonAccounts(content) {
  const parsed = JSON.parse(String(content));
  const records = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.accounts)
      ? parsed.accounts
      : Array.isArray(parsed?.data)
        ? parsed.data
        : [parsed];

  return dedupeAccounts(records.map((record) => normalizeAccountRecord(record)).filter(Boolean));
}

export function parseAccountsContent(content, format = "auto") {
  const source = String(content || "").trim();
  if (!source) {
    return [];
  }

  const shouldParseJson =
    format === "json" || (format === "auto" && (source.startsWith("[") || source.startsWith("{")));

  if (shouldParseJson) {
    return parseJsonAccounts(source);
  }

  return parseTextAccounts(source);
}

function serializeAccount(account) {
  return {
    username: account.username,
    ...(account.password ? { password: account.password } : {}),
    ...(account.token ? { token: account.token } : {}),
    ...(account.cookie ? { cookie: account.cookie } : {}),
    ...(account.userId ? { userId: account.userId } : {}),
    ...(account.displayName ? { displayName: account.displayName } : {}),
    ...(account.expiresAt ? { expiresAt: account.expiresAt } : {})
  };
}

export function saveAccounts(accounts, accountFileOverride = null) {
  const normalized = dedupeAccounts(accounts.map((account) => normalizeAccountRecord(account)).filter(Boolean));
  const accountFile = getAccountFilePath(accountFileOverride);
  fs.mkdirSync(path.dirname(accountFile), { recursive: true });
  fs.writeFileSync(
    accountFile,
    `${JSON.stringify(normalized.map(serializeAccount), null, 2)}\n`,
    "utf8"
  );

  return {
    accountFile,
    count: normalized.length,
    accounts: normalized
  };
}

export function loadAccounts(accountFileOverride = null) {
  const accountFile = getAccountFilePath(accountFileOverride);

  if (!fs.existsSync(accountFile)) {
    return [];
  }

  return parseAccountsContent(fs.readFileSync(accountFile, "utf8"));
}
