import express from "express";
import {
  clearActiveSession,
  clearSessionCookie,
  getAuthConfig,
  getSessionFromRequest,
  isValidPassword,
  setSessionCookie
} from "../utils/auth.js";

const router = express.Router();

function ok(res, data, message = "ok") {
  res.json({ success: true, message, data });
}

router.get("/session", (req, res) => {
  const session = getSessionFromRequest(req);

  if (!session) {
    res.status(401).json({
      success: false,
      message: "未登录",
      data: {
        authenticated: false,
        username: null,
        expiresAt: null
      }
    });
    return;
  }

  ok(res, session);
});

router.get("/config", (_req, res) => {
  const { username } = getAuthConfig();
  ok(res, { username });
});

router.post("/login", (req, res) => {
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  const { username } = getAuthConfig();

  if (!isValidPassword(password)) {
    res.status(401).json({
      success: false,
      message: "密码错误",
      data: null
    });
    return;
  }

  setSessionCookie(res, username);
  ok(
    res,
    {
      authenticated: true,
      username
    },
    "登录成功"
  );
});

router.post("/logout", (_req, res) => {
  clearActiveSession();
  clearSessionCookie(res);
  ok(
    res,
    {
      authenticated: false,
      username: null
    },
    "已退出登录"
  );
});

export default router;
