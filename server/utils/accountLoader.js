import fs from "node:fs";
import path from "node:path";

function getDefaultAccountFile() {
  return path.resolve(process.cwd(), "accounts.txt");
}

export function getAccountFilePath() {
  return process.env.CAOWO_ACCOUNTS_FILE || getDefaultAccountFile();
}

function cleanValue(value = "") {
  return value.trim().replace(/^["']|["']$/g, "");
}

function parseKeyValueLine(line) {
  const normalized = line
    .replace(/，/g, ",")
    .replace(/：/g, ":")
    .replace(/\s+/g, " ")
    .trim();

  const usernameMatch = normalized.match(/(?:账号|用户名|username|user)\s*[:=]\s*([^,;，；]+)/i);
  const passwordMatch = normalized.match(/(?:密码|password|pass)\s*[:=]\s*([^,;，；]+)/i);

  if (!usernameMatch || !passwordMatch) return null;

  return {
    username: cleanValue(usernameMatch[1]),
    password: cleanValue(passwordMatch[1])
  };
}

function parseCsvLine(line) {
  const parts = line
    .replace(/，/g, ",")
    .split(",")
    .map((part) => cleanValue(part));

  if (parts.length < 2 || !parts[0] || !parts[1]) return null;

  return {
    username: parts[0],
    password: parts.slice(1).join(",")
  };
}

function normalizeAccountRecord(record) {
  if (!record) return null;

  if (typeof record === "string") {
    return parseKeyValueLine(record) || parseCsvLine(record);
  }

  if (Array.isArray(record)) {
    if (record.length < 2) return null;
    return {
      username: cleanValue(record[0]),
      password: cleanValue(record.slice(1).join(","))
    };
  }

  if (typeof record === "object") {
    const username = cleanValue(
      record.username ??
        record.user ??
        record.account ??
        record.name ??
        record.账号 ??
        record.用户名 ??
        ""
    );
    const password = cleanValue(record.password ?? record.pass ?? record.pwd ?? record.密码 ?? "");

    if (!username || !password) return null;

    return {
      username,
      password
    };
  }

  return null;
}

function dedupeAccounts(accounts) {
  const seen = new Set();

  return accounts.filter((account) => {
    if (!account?.username || !account?.password) return false;
    if (seen.has(account.username)) return false;
    seen.add(account.username);
    return true;
  });
}

function parseTextAccounts(content) {
  return dedupeAccounts(
    String(content)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && !line.startsWith("//"))
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
        : [];

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

export function saveAccounts(accounts) {
  const normalized = dedupeAccounts(accounts.map((account) => normalizeAccountRecord(account)).filter(Boolean));
  const accountFile = getAccountFilePath();
  fs.mkdirSync(path.dirname(accountFile), { recursive: true });
  fs.writeFileSync(
    accountFile,
    normalized.map((account) => `${account.username},${account.password}`).join("\n"),
    "utf8"
  );

  return {
    accountFile,
    count: normalized.length,
    accounts: normalized
  };
}

export function loadAccounts() {
  const accountFile = getAccountFilePath();

  if (!fs.existsSync(accountFile)) {
    return [];
  }

  return parseTextAccounts(fs.readFileSync(accountFile, "utf8"));
}
