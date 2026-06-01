import { handleApiError, sendJson } from "../lib/auth.mjs";
import { courses, defaultRestoreCodes, pairCourses } from "../lib/courses.mjs";

export default async function handler(req, res) {
  try {
    sendJson(res, 200, {
      ok: true,
      courses,
      courseCount: courses.length,
      pairCount: pairCourses().length,
      defaultRestoreCodes: defaultRestoreCodes(),
      categories: Array.from(new Set(courses.map((course) => course.lb).filter(Boolean))),
      server: {
        hasToken: Boolean(process.env.APP_TOKEN),
        hasSchoolCookie: Boolean(process.env.YJSJY_COOKIE),
      },
    });
  } catch (error) {
    handleApiError(res, error);
  }
}
