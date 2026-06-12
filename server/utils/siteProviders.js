import path from "node:path";

const DEFAULT_APP_TIMEZONE = "Asia/Shanghai";
const DEFAULT_AUTO_CHECKIN_TIME = "00:01";
const DEFAULT_AUTO_CHECKIN_RETRY_MINUTES = 10;
const DEFAULT_PROVIDER_ID = "muyuan";
const PROVIDER_ALIASES = {
  caowo: DEFAULT_PROVIDER_ID,
  joverna: "jiuuij"
};

const PROVIDER_DEFS = {
  muyuan: {
    id: "muyuan",
    label: "MUYUAN",
    displayName: "MUYUAN",
    envPrefix: "MUYUAN",
    legacyEnvPrefixes: ["CAOWO"],
    defaultBaseUrl: "https://muyuan.do/",
    defaultAccountsFile: "accounts.txt",
    defaultRateLimitCooldownMs: 3_600_000,
    defaultUsageSyncDelayMs: 600_000,
    defaultCheckinInitialDelayMs: 1_800_000,
    defaultCheckinMinDelayMs: 1_800_000,
    defaultCheckinMaxDelayMs: 2_700_000,
    defaultCheckinSuccessStepMs: 0,
    defaultCheckinFailureStepMs: 300_000,
    defaultCheckinDelayJitterMs: 300_000,
    defaultCurrencySymbolOverride: ""
  },
  xem8k5: {
    id: "xem8k5",
    label: "XEM8K5",
    displayName: "XEM8K5",
    envPrefix: "XEM8K5",
    defaultBaseUrl: "http://new.xem8k5.top:3000/",
    defaultAccountsFile: "accounts.xem8k5.txt",
    defaultCurrencySymbolOverride: "$"
  },
  dgbmc: {
    id: "dgbmc",
    label: "DGBMC",
    displayName: "DGBMC",
    envPrefix: "DGBMC",
    defaultBaseUrl: "https://freeapi.dgbmc.top/",
    defaultAccountsFile: "accounts.dgbmc.txt",
    defaultCurrencySymbolOverride: "$"
  },
  jiuuij: {
    id: "jiuuij",
    label: "JIUUIJ",
    displayName: "Joverna",
    envPrefix: "JIUUIJ",
    defaultBaseUrl: "https://jiuuij.de5.net/",
    defaultAccountsFile: "accounts.jiuuij.txt",
    defaultRateLimitCooldownMs: 180_000,
    defaultUsageSyncDelayMs: 4_000,
    defaultCurrencySymbolOverride: "$"
  }
};

function getEnvPrefixes(def) {
  return [def.envPrefix, ...(def.legacyEnvPrefixes || [])].filter(Boolean);
}

function getEnv(def, name, fallback) {
  for (const prefix of getEnvPrefixes(def)) {
    const value = process.env[`${prefix}_${name}`];
    if (value != null && value !== "") return value;
  }
  return fallback;
}

function getNumberEnv(def, name, fallback) {
  for (const prefix of getEnvPrefixes(def)) {
    const value = Number(process.env[`${prefix}_${name}`]);
    if (Number.isFinite(value)) return value;
  }
  return fallback;
}

function getBooleanEnv(def, name, fallback) {
  const raw = getEnv(def, name, "");
  if (raw === "") return fallback;
  return !["0", "false", "no", "off"].includes(String(raw).trim().toLowerCase());
}

function buildProviderConfig(def) {
  return {
    id: def.id,
    label: def.label,
    displayName: def.displayName,
    baseUrl: getEnv(def, "BASE_URL", def.defaultBaseUrl),
    accountsFile: getEnv(
      def,
      "ACCOUNTS_FILE",
      path.resolve(process.cwd(), def.defaultAccountsFile)
    ),
    timeoutMs: getNumberEnv(def, "TIMEOUT_MS", 15_000),
    cacheTtlMs: getNumberEnv(def, "CACHE_TTL_MS", 10_000),
    rateLimitCooldownMs: getNumberEnv(
      def,
      "RATE_LIMIT_COOLDOWN_MS",
      def.defaultRateLimitCooldownMs ?? 180_000
    ),
    usageSyncDelayMs: getNumberEnv(
      def,
      "USAGE_SYNC_DELAY_MS",
      def.defaultUsageSyncDelayMs ?? 4_000
    ),
    checkinInitialDelayMs: getNumberEnv(
      def,
      "CHECKIN_INITIAL_DELAY_MS",
      def.defaultCheckinInitialDelayMs ?? 2_500
    ),
    checkinMinDelayMs: getNumberEnv(
      def,
      "CHECKIN_MIN_DELAY_MS",
      def.defaultCheckinMinDelayMs ?? 1_500
    ),
    checkinMaxDelayMs: getNumberEnv(
      def,
      "CHECKIN_MAX_DELAY_MS",
      def.defaultCheckinMaxDelayMs ?? 10_000
    ),
    checkinSuccessStepMs: getNumberEnv(
      def,
      "CHECKIN_SUCCESS_STEP_MS",
      def.defaultCheckinSuccessStepMs ?? 250
    ),
    checkinFailureStepMs: getNumberEnv(
      def,
      "CHECKIN_FAILURE_STEP_MS",
      def.defaultCheckinFailureStepMs ?? 1_000
    ),
    checkinDelayJitterMs: getNumberEnv(
      def,
      "CHECKIN_DELAY_JITTER_MS",
      def.defaultCheckinDelayJitterMs ?? 0
    ),
    quotaDisplayTypeOverride: getEnv(
      def,
      "QUOTA_DISPLAY_TYPE_OVERRIDE",
      def.defaultQuotaDisplayTypeOverride || ""
    ),
    currencySymbolOverride: getEnv(
      def,
      "CURRENCY_SYMBOL_OVERRIDE",
      def.defaultCurrencySymbolOverride || ""
    ),
    autoCheckinEnabled: getBooleanEnv(def, "AUTO_CHECKIN_ENABLED", true),
    autoCheckinTime: getEnv(def, "AUTO_CHECKIN_TIME", DEFAULT_AUTO_CHECKIN_TIME),
    autoCheckinTz: getEnv(def, "AUTO_CHECKIN_TZ", DEFAULT_APP_TIMEZONE),
    autoCheckinCatchUp: getBooleanEnv(def, "AUTO_CHECKIN_CATCH_UP", true),
    autoCheckinRetryMinutes: Math.max(
      1,
      getNumberEnv(def, "AUTO_CHECKIN_RETRY_MINUTES", DEFAULT_AUTO_CHECKIN_RETRY_MINUTES)
    )
  };
}

export function getProviderConfig(providerId = DEFAULT_PROVIDER_ID) {
  return buildProviderConfig(PROVIDER_DEFS[normalizeProviderId(providerId)]);
}

export function getProviderList() {
  return Object.values(PROVIDER_DEFS).map((def) => {
    const provider = buildProviderConfig(def);
    return {
    id: provider.id,
    label: provider.label,
    displayName: provider.displayName,
    baseUrl: provider.baseUrl
    };
  });
}

export function normalizeProviderId(providerId = DEFAULT_PROVIDER_ID) {
  const rawProviderId = String(providerId || DEFAULT_PROVIDER_ID).toLowerCase();
  const normalizedProviderId = PROVIDER_ALIASES[rawProviderId] || rawProviderId;
  return PROVIDER_DEFS[normalizedProviderId] ? normalizedProviderId : DEFAULT_PROVIDER_ID;
}
