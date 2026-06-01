import { timingSafeEqual } from "node:crypto";

export class HttpError extends Error {
  constructor(status, message, details = undefined) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.details = details;
  }
}

export function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}

export function handleApiError(res, error) {
  const status = Number(error?.status) || 500;
  sendJson(res, status, {
    ok: false,
    error: error?.message || "服务器异常",
    details: error?.details,
  });
}

export async function readJson(req) {
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) {
    return req.body;
  }
  if (typeof req.body === "string") {
    return req.body.trim() ? JSON.parse(req.body) : {};
  }

  let text = "";
  for await (const chunk of req) {
    text += chunk;
  }
  return text.trim() ? JSON.parse(text) : {};
}

export function getHeader(req, name) {
  const key = name.toLowerCase();
  const value = req.headers?.[key] ?? req.headers?.[name];
  return Array.isArray(value) ? value[0] : value;
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function getRequestToken(req) {
  const auth = getHeader(req, "authorization") || "";
  if (auth.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim();
  }

  try {
    const url = new URL(req.url, "http://localhost");
    return url.searchParams.get("token") || "";
  } catch {
    return "";
  }
}

export function assertAuth(req) {
  const expected = process.env.APP_TOKEN || "";
  if (!expected) {
    return { configured: false };
  }

  const token = getRequestToken(req);
  if (!token || !safeEqual(token, expected)) {
    throw new HttpError(401, "Token 无效或缺失");
  }
  return { configured: true };
}

export function getSchoolCookie(req) {
  const fromHeader = getHeader(req, "x-school-cookie");
  return String(fromHeader || process.env.YJSJY_COOKIE || "").trim();
}

export function requireSchoolCookie(req) {
  const cookie = getSchoolCookie(req);
  if (!cookie) {
    throw new HttpError(400, "缺少学校登录 Token/Cookie。请在页面点击“获取学校 Token”。");
  }
  return cookie;
}
