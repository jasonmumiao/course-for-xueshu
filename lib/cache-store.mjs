import fs from "node:fs/promises";
import path from "node:path";
import { get as getBlob, put as putBlob } from "@vercel/blob";
import { courses } from "./courses.mjs";

const CACHE_KEY = "uestc-course-quota:latest";
const BLOB_KEY = "uestc-course-quota/latest.json";
const LOCAL_CACHE_PATH = path.join("/tmp", "uestc-course-quota-cache.json");

function redisConfig() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "";
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "";
  return { url: url.replace(/\/+$/, ""), token };
}

export function storageInfo() {
  const { url, token } = redisConfig();
  const hasBlob = Boolean(process.env.BLOB_READ_WRITE_TOKEN || (process.env.BLOB_STORE_ID && process.env.VERCEL_OIDC_TOKEN));
  return {
    driver: url && token ? "upstash-redis" : hasBlob ? "vercel-blob" : "tmp-file",
    persistent: Boolean((url && token) || hasBlob),
  };
}

async function redisCommand(args) {
  const { url, token } = redisConfig();
  if (!url || !token) return null;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(args),
    cache: "no-store",
  });
  const data = await response.json();
  if (!response.ok || data.error) {
    throw new Error(data.error || "Redis REST 请求失败");
  }
  return data.result;
}

function emptyCache() {
  return {
    version: 1,
    updatedAt: "",
    courseCount: courses.length,
    results: {},
  };
}

export async function readStoredJson({ redisKey, blobKey, localPath }) {
  const info = storageInfo();
  if (info.persistent) {
    if (info.driver === "vercel-blob") {
      const value = await getBlob(blobKey, { access: "private", useCache: false });
      if (!value) return null;
      const text = await new Response(value.stream).text();
      return text ? JSON.parse(text) : null;
    }

    const value = await redisCommand(["GET", redisKey]);
    return value ? JSON.parse(value) : null;
  }

  try {
    const text = await fs.readFile(localPath, "utf8");
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function writeStoredJson({ redisKey, blobKey, localPath }, value) {
  const info = storageInfo();
  const text = JSON.stringify(value);
  if (info.driver === "vercel-blob") {
    await putBlob(blobKey, text, {
      access: "private",
      allowOverwrite: true,
      contentType: "application/json; charset=utf-8",
      cacheControlMaxAge: 60,
    });
    return value;
  }

  if (info.driver === "upstash-redis") {
    await redisCommand(["SET", redisKey, text]);
    return value;
  }

  await fs.writeFile(localPath, JSON.stringify(value, null, 2), "utf8");
  return value;
}

function normalizeCache(value) {
  if (!value || typeof value !== "object") return emptyCache();
  return {
    version: 1,
    updatedAt: value.updatedAt || "",
    courseCount: courses.length,
    results: value.results && typeof value.results === "object" ? value.results : {},
  };
}

export async function readQuotaCache() {
  return normalizeCache(await readStoredJson({
    redisKey: CACHE_KEY,
    blobKey: BLOB_KEY,
    localPath: LOCAL_CACHE_PATH,
  }));
}

export async function writeQuotaCache(cache) {
  const value = normalizeCache(cache);
  return writeStoredJson({
    redisKey: CACHE_KEY,
    blobKey: BLOB_KEY,
    localPath: LOCAL_CACHE_PATH,
  }, value);
}

export async function mergeQuotaResults(results) {
  const now = new Date().toISOString();
  const cache = await readQuotaCache();
  for (const result of results || []) {
    if (!result?.course?.kcbh) continue;
    cache.results[result.course.kcbh] = {
      ...result,
      updatedAt: result.updatedAt || now,
    };
  }
  cache.updatedAt = now;
  cache.courseCount = courses.length;
  return writeQuotaCache(cache);
}
