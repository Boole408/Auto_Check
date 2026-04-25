import express from "express";
import { loadAccounts, parseAccountsContent, saveAccounts } from "../utils/accountLoader.js";
import { requireAuth } from "../utils/auth.js";
import {
  checkinAccount,
  clearDashboardCache,
  getDashboard,
  isRateLimitError,
  startOrResumeCheckinQueue
} from "../utils/caowo.js";

const router = express.Router();

function ok(res, data, message = "ok") {
  res.json({ success: true, message, data });
}

function sendEmptyAccounts(res) {
  res.status(400).json({
    success: false,
    message: "未读取到账号，请检查 accounts.txt 或 CAOWO_ACCOUNTS_FILE",
    data: null
  });
}

router.use(requireAuth);

router.get("/", async (req, res, next) => {
  try {
    const selectedUsername =
      typeof req.query.selected === "string" && req.query.selected.trim()
        ? req.query.selected.trim()
        : null;

    const dashboard = await getDashboard({
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
    const username = decodeURIComponent(req.params.username);
    const account = loadAccounts().find((item) => item.username === username);

    if (!account) {
      res.status(404).json({
        success: false,
        message: "账号不存在，请检查 accounts.txt",
        data: null
      });
      return;
    }

    const result = await checkinAccount(account);
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

router.post("/checkin-all", async (req, res, next) => {
  try {
    const accounts = loadAccounts();
    if (!accounts.length) {
      sendEmptyAccounts(res);
      return;
    }

    const scope = req.body?.scope === "failed" ? "failed" : "all";
    const result = await startOrResumeCheckinQueue(scope);
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
    const content = typeof req.body?.content === "string" ? req.body.content : "";
    const format = req.body?.format === "json" || req.body?.format === "txt" ? req.body.format : "auto";
    const accounts = parseAccountsContent(content, format);

    if (!accounts.length) {
      res.status(400).json({
        success: false,
        message: "未解析到有效账号，请检查 txt/json 内容格式",
        data: null
      });
      return;
    }

    const result = saveAccounts(accounts);
    clearDashboardCache();

    ok(
      res,
      {
        accountFile: result.accountFile,
        count: result.count,
        usernames: result.accounts.map((account) => account.username)
      },
      `已导入 ${result.count} 个账号`
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
