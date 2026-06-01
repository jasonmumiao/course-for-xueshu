import { assertConfiguredAuth, getSchoolCookie, handleApiError, sendJson } from "../lib/auth.mjs";
import { defaultRestoreCodes } from "../lib/courses.mjs";
import { detectLcid, getSelectedExchangeCourses } from "../lib/school-client.mjs";

export default async function handler(req, res) {
  try {
    assertConfiguredAuth(req);
    const cookie = getSchoolCookie(req);
    if (!cookie) {
      sendJson(res, 200, {
        ok: true,
        schoolReady: false,
        selected: [],
        lcid: "",
        defaultRestoreCodes: defaultRestoreCodes(),
        server: {
          hasSchoolCookie: Boolean(process.env.YJSJY_COOKIE),
        },
      });
      return;
    }

    const [selectedResult, lcidResult] = await Promise.allSettled([
      getSelectedExchangeCourses(cookie),
      detectLcid(cookie),
    ]);

    if (selectedResult.status === "rejected") {
      throw selectedResult.reason;
    }

    sendJson(res, 200, {
      ok: true,
      schoolReady: true,
      selected: selectedResult.value,
      lcid: lcidResult.status === "fulfilled" ? lcidResult.value : "",
      lcidError: lcidResult.status === "rejected" ? lcidResult.reason?.message : "",
      defaultRestoreCodes: defaultRestoreCodes(),
      server: {
        hasSchoolCookie: Boolean(process.env.YJSJY_COOKIE),
      },
    });
  } catch (error) {
    handleApiError(res, error);
  }
}
