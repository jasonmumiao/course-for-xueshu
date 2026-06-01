import { assertAuth, handleApiError, readJson, requireSchoolCookie, sendJson } from "../lib/auth.mjs";
import { mergeQuotaResults } from "../lib/cache-store.mjs";
import { getCoursesFromCodes, normalizeCourseCodes } from "../lib/courses.mjs";
import { refreshCourses, requestDelayMs, setPlanCourses } from "../lib/school-client.mjs";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { ok: false, error: "Method Not Allowed" });
    return;
  }

  let restoreError = null;
  let body = {};

  try {
    assertAuth(req);
    const cookie = requireSchoolCookie(req);
    body = await readJson(req);
    const codes = normalizeCourseCodes(body.codes);
    if (!codes.length || codes.length > 2) {
      throw Object.assign(new Error("每次只能刷新 1 到 2 门课程"), { status: 400 });
    }

    const result = await refreshCourses(cookie, codes, {
      delayMs: body.delayMs,
    });
    const cache = await mergeQuotaResults(result.results);

    if (body.restoreAfter) {
      try {
        const restoreCourses = getCoursesFromCodes(body.restoreCodes || []);
        await setPlanCourses(cookie, restoreCourses, requestDelayMs(body.delayMs));
      } catch (error) {
        restoreError = error;
      }
    }

    sendJson(res, 200, {
      ok: true,
      ...result,
      cacheUpdatedAt: cache.updatedAt,
      restored: Boolean(body.restoreAfter) && !restoreError,
      restoreError: restoreError?.message || "",
    });
  } catch (error) {
    handleApiError(res, error);
  }
}
