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

export function loadAccounts() {
  const accountFile = getAccountFilePath();

  if (!fs.existsSync(accountFile)) {
    return [];
  }

  const content = fs.readFileSync(accountFile, "utf8");
  const seen = new Set();

  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && !line.startsWith("//"))
    .map((line) => parseKeyValueLine(line) || parseCsvLine(line))
    .filter(Boolean)
    .filter((account) => {
      if (seen.has(account.username)) return false;
      seen.add(account.username);
      return true;
    });
}
