import { assertConfiguredAuth, handleApiError, readJson, requireSchoolCookie, sendJson } from "../lib/auth.mjs";
import { getCoursesFromCodes } from "../lib/courses.mjs";
import { requestDelayMs, setPlanCourses } from "../lib/school-client.mjs";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { ok: false, error: "Method Not Allowed" });
    return;
  }

  try {
    assertConfiguredAuth(req);
    const cookie = requireSchoolCookie(req);
    const body = await readJson(req);
    const courses = getCoursesFromCodes(body.codes || []);
    const selected = await setPlanCourses(cookie, courses, requestDelayMs(body.delayMs));
    sendJson(res, 200, {
      ok: true,
      restored: true,
      selected,
    });
  } catch (error) {
    handleApiError(res, error);
  }
}
