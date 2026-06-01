import { handleApiError, readJson, sendJson } from "../lib/auth.mjs";
import { addCourseComment, readPublicComments } from "../lib/comment-store.mjs";

export default async function handler(req, res) {
  try {
    if (req.method === "GET") {
      sendJson(res, 200, {
        ok: true,
        comments: await readPublicComments(),
      });
      return;
    }

    if (req.method === "POST") {
      const body = await readJson(req);
      const result = await addCourseComment(req, body);
      sendJson(res, 200, {
        ok: true,
        ...result,
      });
      return;
    }

    sendJson(res, 405, { ok: false, error: "Method Not Allowed" });
  } catch (error) {
    handleApiError(res, error);
  }
}
