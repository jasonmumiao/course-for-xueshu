import { createHmac, timingSafeEqual } from "node:crypto";

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

function appSecret() {
  return process.env.APP_TOKEN || "";
}

function schoolOrigin() {
  return (process.env.SCHOOL_ORIGIN || "https://yjsjy.uestc.edu.cn").replace(/\/+$/, "");
}

function reportTtlMs() {
  return Math.max(5 * 60 * 1000, Number(process.env.REPORT_TOKEN_TTL_MS || 6 * 60 * 60 * 1000) || 6 * 60 * 60 * 1000);
}

function reportSignature(scope, issuedAt, secret = appSecret()) {
  return createHmac("sha256", secret).update(String(scope) + "." + String(issuedAt)).digest("hex");
}

function requestUrl(req) {
  return new URL(req.url, "http://localhost");
}

export function setSchoolCors(req, res) {
  const origin = getHeader(req, "origin") || "";
  const allowed = schoolOrigin();
  if (origin === allowed) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Vary", "Origin");
}

export function assertSchoolOrigin(req) {
  const origin = getHeader(req, "origin") || "";
  const referer = getHeader(req, "referer") || "";
  const allowed = schoolOrigin();

  if (!origin) {
    throw new HttpError(403, "缺少学校页面来源");
  }

  if (origin && origin !== allowed) {
    throw new HttpError(403, "回传来源不是学校页面");
  }

  if (referer && !referer.startsWith(allowed + "/")) {
    throw new HttpError(403, "回传来源不是学校页面");
  }

  return { origin, allowed };
}

export function createReportAuthQuery(scope) {
  const secret = appSecret();
  if (!secret) return "";

  const reportScope = String(scope || "all");
  const issuedAt = String(Date.now());
  const params = new URLSearchParams({
    reportScope,
    reportTs: issuedAt,
    reportSig: reportSignature(reportScope, issuedAt, secret),
  });
  return "?" + params.toString();
}

export function assertReportAuth(req, body = {}) {
  const secret = appSecret();
  if (!secret) {
    return { configured: false };
  }

  const url = requestUrl(req);
  const scope = url.searchParams.get("reportScope") || "";
  const issuedAt = url.searchParams.get("reportTs") || "";
  const signature = url.searchParams.get("reportSig") || "";
  if (!scope || !issuedAt || !signature) {
    throw new HttpError(401, "回传签名缺失，请重新生成书签");
  }

  const issuedAtNumber = Number(issuedAt);
  if (!Number.isFinite(issuedAtNumber) || Math.abs(Date.now() - issuedAtNumber) > reportTtlMs()) {
    throw new HttpError(401, "回传签名已过期，请重新生成书签");
  }

  const expected = reportSignature(scope, issuedAt, secret);
  if (!safeEqual(signature, expected)) {
    throw new HttpError(401, "回传签名无效，请重新生成书签");
  }

  if (scope !== "all") {
    const allowedCodes = new Set(scope.split(",").map((item) => item.trim()).filter(Boolean));
    const incomingCodes = (Array.isArray(body?.results) ? body.results : [])
      .map((item) => String(item?.course?.kcbh || "").trim())
      .filter(Boolean);
    if (incomingCodes.some((code) => !allowedCodes.has(code))) {
      throw new HttpError(403, "回传课程不在本次刷新范围内");
    }
  }

  return { configured: true, scope };
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
  const expected = appSecret();
  if (!expected) {
    return { configured: false };
  }

  const token = getRequestToken(req);
  if (!token || !safeEqual(token, expected)) {
    throw new HttpError(401, "Token 无效或缺失");
  }
  return { configured: true };
}

export function assertConfiguredAuth(req) {
  if (!appSecret()) {
    throw new HttpError(403, "该接口需要先配置 APP_TOKEN");
  }
  return assertAuth(req);
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
