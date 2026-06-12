import fs from "node:fs";
import path from "node:path";

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

function normalizeDelimitedLine(line) {
  return String(line)
    .replace(/^\uFEFF/, "")
    .replace(/，/g, ",")
    .replace(/；/g, ";")
    .replace(/：/g, ":")
    .trim();
}

function isHeaderField(value, candidates) {
  return candidates.includes(cleanValue(value).toLowerCase());
}

function isHeaderRecord(username, password) {
  return (
    isHeaderField(username, ["username", "user", "account", "账号", "用户名", "账户"]) &&
    isHeaderField(password, ["password", "pass", "pwd", "密码"])
  );
}

function parseKeyValueLine(line) {
  const normalized = normalizeDelimitedLine(line)
    .replace(/\s+/g, " ")
    .trim();

  const usernameMatch = normalized.match(
    /(?:账号|用户名|username|user)\s*[:=]\s*(.*?)(?=\s*(?:密码|password|pass)\s*[:=]|[,;]|$)/i
  );
  const passwordMatch = normalized.match(/(?:密码|password|pass)\s*[:=]\s*([^,;]+)/i);

  if (usernameMatch && passwordMatch) {
    return {
      username: cleanValue(usernameMatch[1]),
      password: cleanValue(passwordMatch[1])
    };
  }

  const compactPasswordMatch = normalized.match(/^(.+?)\s*(?:密码|password|pass)\s*[:=]\s*([^,;]+)/i);
  if (!compactPasswordMatch) return null;

  return {
    username: cleanValue(compactPasswordMatch[1]),
    password: cleanValue(compactPasswordMatch[2])
  };
}

function parseCsvLine(line) {
  const normalized = normalizeDelimitedLine(line);
  const joiner =
    normalized.includes(",") || normalized.includes(";")
      ? ","
      : normalized.includes("\t")
        ? "\t"
        : " ";
  const delimiter =
    joiner === ","
      ? /[;,]/
      : joiner === "\t"
        ? /\t+/
        : /\s+/;
  const parts = normalized
    .split(delimiter)
    .map((part) => cleanValue(part))
    .filter(Boolean);

  if (parts.length < 2 || !parts[0] || !parts[1]) return null;
  if (isHeaderRecord(parts[0], parts[1])) return null;

  return {
    username: parts[0],
    password: parts.slice(1).join(joiner === "," ? "," : " ")
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

export function saveAccounts(accounts, accountFileOverride = null) {
  const normalized = dedupeAccounts(accounts.map((account) => normalizeAccountRecord(account)).filter(Boolean));
  const accountFile = getAccountFilePath(accountFileOverride);
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

export function loadAccounts(accountFileOverride = null) {
  const accountFile = getAccountFilePath(accountFileOverride);

  if (!fs.existsSync(accountFile)) {
    return [];
  }

  return parseTextAccounts(fs.readFileSync(accountFile, "utf8"));
}
