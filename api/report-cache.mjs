import { assertAuth, handleApiError, readJson, sendJson } from "../lib/auth.mjs";
import { mergeQuotaResults, readQuotaCache, storageInfo } from "../lib/cache-store.mjs";
import { getCourse } from "../lib/courses.mjs";

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }
  if (req.method !== "POST") {
    sendJson(res, 405, { ok: false, error: "Method Not Allowed" });
    return;
  }

  try {
    assertAuth(req);
    const body = await readJson(req);
    if (body?.source !== "uestc-course-quota-report") {
      throw Object.assign(new Error("无效的上报来源"), { status: 400 });
    }

    const incoming = Array.isArray(body.results) ? body.results : [];
    const results = incoming
      .filter((item) => item?.course?.kcbh && getCourse(item.course.kcbh))
      .slice(0, 120);

    if (!results.length) {
      throw Object.assign(new Error("没有可写入的课程结果"), { status: 400 });
    }

    const cache = await mergeQuotaResults(results);
    sendJson(res, 200, {
      ok: true,
      cacheUpdatedAt: cache.updatedAt,
      cache: await readQuotaCache(),
      storage: storageInfo(),
    });
  } catch (error) {
    handleApiError(res, error);
  }
}
