import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { HttpError, getHeader } from "./auth.mjs";
import { readStoredJson, writeStoredJson } from "./cache-store.mjs";
import { courses, getCourse } from "./courses.mjs";

const COMMENT_STORE = {
  redisKey: "uestc-course-quota:comments",
  blobKey: "uestc-course-quota/comments.json",
  localPath: path.join("/tmp", "uestc-course-quota-comments.json"),
};

const MAX_COMMENTS_PER_COURSE = 200;
const MAX_AUTHOR_LENGTH = 20;
const MAX_MESSAGE_LENGTH = 300;
const COMMENT_COOLDOWN_MS = 15 * 1000;

function emptyComments() {
  return {
    version: 1,
    updatedAt: "",
    courseCount: courses.length,
    comments: {},
  };
}

function normalizeText(value, maxLength) {
  return String(value || "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/\s+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim()
    .slice(0, maxLength);
}

function normalizeComments(value) {
  const base = emptyComments();
  if (!value || typeof value !== "object") return base;
  const comments = {};
  for (const [code, items] of Object.entries(value.comments || {})) {
    if (!getCourse(code) || !Array.isArray(items)) continue;
    comments[code] = items
      .filter((item) => item?.id && item?.message && item?.createdAt)
      .slice(-MAX_COMMENTS_PER_COURSE)
      .map((item) => ({
        id: String(item.id),
        courseCode: String(code),
        author: normalizeText(item.author || "匿名同学", MAX_AUTHOR_LENGTH) || "匿名同学",
        message: normalizeText(item.message, MAX_MESSAGE_LENGTH),
        createdAt: String(item.createdAt),
        ipAddress: String(item.ipAddress || ""),
        ipHash: String(item.ipHash || ""),
        ipMasked: String(item.ipMasked || ""),
        userAgent: String(item.userAgent || ""),
      }));
  }

  return {
    ...base,
    updatedAt: value.updatedAt || "",
    comments,
  };
}

function clientIp(req) {
  const forwarded = getHeader(req, "x-forwarded-for") || "";
  const real = getHeader(req, "x-real-ip") || "";
  const candidate = forwarded.split(",")[0].trim() || real.trim() || req.socket?.remoteAddress || "";
  return candidate || "unknown";
}

function maskIp(ip) {
  const text = String(ip || "");
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(text)) {
    const parts = text.split(".");
    return `${parts[0]}.${parts[1]}.*.*`;
  }
  if (text.includes(":")) {
    return text.split(":").slice(0, 3).join(":") + ":*";
  }
  return "unknown";
}

function ipFingerprint(ip) {
  const salt = process.env.COMMENT_SALT || process.env.APP_TOKEN || "uestc-course-quota-comment-salt";
  return createHash("sha256").update(salt + "\0" + String(ip || "unknown")).digest("hex");
}

function publicComment(item) {
  const fingerprint = String(item.ipHash || "").slice(0, 8) || "unknown";
  return {
    id: item.id,
    courseCode: item.courseCode,
    author: item.author,
    message: item.message,
    createdAt: item.createdAt,
    visitorLabel: `同学 ${fingerprint}`,
  };
}

function publicCommentsByCourse(cache) {
  const result = {};
  for (const [code, items] of Object.entries(cache.comments || {})) {
    result[code] = items.map(publicComment);
  }
  return result;
}

export async function readCommentCache() {
  return normalizeComments(await readStoredJson(COMMENT_STORE));
}

export async function readPublicComments() {
  const cache = await readCommentCache();
  return {
    version: cache.version,
    updatedAt: cache.updatedAt,
    courseCount: cache.courseCount,
    comments: publicCommentsByCourse(cache),
  };
}

export async function addCourseComment(req, body) {
  const courseCode = String(body?.courseCode || "").trim();
  if (!getCourse(courseCode)) {
    throw new HttpError(400, "课程不存在");
  }

  const author = normalizeText(body?.author || "匿名同学", MAX_AUTHOR_LENGTH) || "匿名同学";
  const message = normalizeText(body?.message, MAX_MESSAGE_LENGTH);
  if (message.length < 2) {
    throw new HttpError(400, "留言至少需要 2 个字");
  }

  const ip = clientIp(req);
  const ipHash = ipFingerprint(ip);
  const now = new Date();
  const cache = await readCommentCache();
  const items = cache.comments[courseCode] || [];
  const last = [...items].reverse().find((item) => item.ipHash === ipHash);
  if (last && now - new Date(last.createdAt) < COMMENT_COOLDOWN_MS) {
    throw new HttpError(429, "留言太频繁，请稍后再试");
  }

  const comment = {
    id: randomUUID(),
    courseCode,
    author,
    message,
    createdAt: now.toISOString(),
    ipAddress: ip,
    ipHash,
    ipMasked: maskIp(ip),
    userAgent: String(getHeader(req, "user-agent") || "").slice(0, 300),
  };

  cache.comments[courseCode] = [...items, comment].slice(-MAX_COMMENTS_PER_COURSE);
  cache.updatedAt = now.toISOString();
  await writeStoredJson(COMMENT_STORE, cache);

  return {
    comment: publicComment(comment),
    comments: cache.comments[courseCode].map(publicComment),
  };
}
