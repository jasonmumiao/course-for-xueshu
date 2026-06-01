import { handleApiError, sendJson } from "../lib/auth.mjs";
import { readQuotaCache, storageInfo } from "../lib/cache-store.mjs";

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") {
      sendJson(res, 405, { ok: false, error: "Method Not Allowed" });
      return;
    }

    sendJson(res, 200, {
      ok: true,
      cache: await readQuotaCache(),
      storage: storageInfo(),
    });
  } catch (error) {
    handleApiError(res, error);
  }
}
