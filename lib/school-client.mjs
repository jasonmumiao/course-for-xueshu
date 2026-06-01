import { HttpError } from "./auth.mjs";
import { courseById, getCoursesFromCodes } from "./courses.mjs";

const ORIGIN = (process.env.SCHOOL_ORIGIN || "https://yjsjy.uestc.edu.cn").replace(/\/+$/, "");
const BXHJ_PLACEHOLDER = "XX0003XXXX";

export function requestDelayMs(value = process.env.REQUEST_DELAY_MS) {
  const delay = Number(value);
  return Number.isFinite(delay) && delay >= 0 ? delay : 900;
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeResponseText(text) {
  return String(text == null ? "" : text).trim().replace(/^"|"$/g, "");
}

function decodeHtml(text) {
  return String(text || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(Number.parseInt(code, 16)));
}

function stripHtml(html) {
  return decodeHtml(
    String(html || "")
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
  ).replace(/\s+/g, " ").trim();
}

function toNumber(value) {
  const text = String(value ?? "").replace(/,/g, "").replace(/[^\d.-]/g, "");
  if (!text || text === "-" || text === ".") return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

async function schoolFetch(cookie, path, options = {}) {
  const url = path.startsWith("http") ? path : ORIGIN + path;
  const headers = {
    Accept: "*/*",
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit/537.36 Chrome Safari/537.36",
    Cookie: cookie,
    ...options.headers,
  };

  const response = await fetch(url, {
    method: options.method || "GET",
    headers,
    body: options.body,
    redirect: "manual",
    cache: "no-store",
  });
  const text = await response.text();
  const snippet = text.slice(0, 1000);

  if (response.status >= 300 && response.status < 400) {
    throw new HttpError(401, "学校登录状态失效：接口发生跳转", {
      location: response.headers.get("location"),
    });
  }
  if (/\/pyxx\/account\/login|account\/login/i.test(snippet) || (/<html|<!doctype/i.test(snippet) && /登录|统一身份认证/.test(snippet))) {
    throw new HttpError(401, "学校登录状态失效，请重新点击“获取学校 Token”");
  }
  if (!response.ok) {
    throw new HttpError(502, `学校接口 HTTP ${response.status}`, {
      path,
      snippet: text.slice(0, 200),
    });
  }
  return text;
}

export async function detectLcid(cookie) {
  const html = await schoolFetch(cookie, "/pyxx/pygl/pyjhxk/wsxk?_=" + Date.now(), {
    headers: {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
  });
  const match = html.match(/lcid\s*[:=]\s*['"]?(\d+)/i) || html.match(/[?&]lcid=(\d+)/i);
  return match ? match[1] : "";
}

export async function getExchangeList(cookie) {
  const params = new URLSearchParams({
    sEcho: "1",
    iColumns: "13",
    sColumns: "",
    iDisplayStart: "0",
    iDisplayLength: "1000",
    mDataProp_0: "KCBH",
    mDataProp_1: "KCMC",
    mDataProp_2: "YXMC",
    mDataProp_3: "KCXF",
    mDataProp_4: "KCZXS",
    mDataProp_5: "KKJJ",
    mDataProp_6: "KSFS",
    mDataProp_7: "LB",
    mDataProp_8: "KCLX",
    mDataProp_9: "SFYX",
    mDataProp_10: "KCLBM",
    mDataProp_11: "SFBFA",
    mDataProp_12: "KCBH",
    kcbh: "",
    kcbh1: BXHJ_PLACEHOLDER,
    sfbfa1: "2",
    bxhjkcbh: BXHJ_PLACEHOLDER,
    sfbfa: "2",
    _: String(Date.now()),
  });

  const text = await schoolFetch(cookie, "/pyxx/pygl/kckk/bxhjlist?" + params.toString(), {
    headers: {
      Accept: "application/json, text/javascript, */*; q=0.01",
      "X-Requested-With": "XMLHttpRequest",
    },
  });
  const data = JSON.parse(text);
  return Array.isArray(data.aaData) ? data.aaData : [];
}

export async function getSelectedExchangeCourses(cookie) {
  const rows = await getExchangeList(cookie);
  return rows
    .filter((row) => String(row.SFYX ?? "0") !== "0")
    .map((row) => {
      const code = String(row.KCBH || "").trim();
      return courseById.get(code) || {
        kcbh: code,
        kcmc: String(row.KCMC || ""),
        yxmc: String(row.YXMC || ""),
        lb: String(row.LB || ""),
        kclbm: String(row.KCLBM || ""),
        sfbfa: String(row.SFBFA || "2"),
      };
    });
}

export async function deleteCourse(cookie, kcbh) {
  const body = new URLSearchParams({ kcbh, kcbhs: kcbh });
  const text = await schoolFetch(cookie, "/pyxx/pygl/pyjhtj/deletekc", {
    method: "POST",
    headers: {
      Accept: "application/json, text/javascript, */*; q=0.01",
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "X-Requested-With": "XMLHttpRequest",
    },
    body: body.toString(),
  });
  return normalizeResponseText(text);
}

export async function addCourse(cookie, course) {
  const body = new URLSearchParams({
    kcbh: course.kcbh,
    kclx: course.kclbm,
    sfbfa: course.sfbfa || "2",
  });
  const text = await schoolFetch(cookie, "/pyxx/pygl/pyjhtj/zjbxhjkc", {
    method: "POST",
    headers: {
      Accept: "application/json, text/javascript, */*; q=0.01",
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "X-Requested-With": "XMLHttpRequest",
    },
    body: body.toString(),
  });
  const result = normalizeResponseText(text);
  if (result !== "1") {
    throw new HttpError(502, `添加课程 ${course.kcbh} 失败`, { result });
  }
  return result;
}

export async function setPlanCourses(cookie, targetCourses, delayMs = requestDelayMs()) {
  const selected = await getSelectedExchangeCourses(cookie);
  for (const course of selected) {
    await deleteCourse(cookie, course.kcbh);
    await sleep(Math.max(200, Math.floor(delayMs / 3)));
  }

  for (const course of targetCourses) {
    await addCourse(cookie, course);
    await sleep(Math.max(200, Math.floor(delayMs / 3)));
  }

  await sleep(delayMs);
  return getSelectedExchangeCourses(cookie);
}

export function parseDxkcRows(html) {
  const rows = [];
  const matches = String(html || "").matchAll(/<tr\b[^>]*id=["']?tr_jhn_[^>]*>([\s\S]*?)<\/tr>/gi);
  for (const match of matches) {
    const cells = Array.from(match[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)).map((cell) => stripHtml(cell[1]));
    if (cells.length < 11) continue;
    const capacity = toNumber(cells[9]);
    const selected = toNumber(cells[10]);
    rows.push({
      bjid: cells[0] || "",
      kcbh: cells[1] || "",
      name: cells[2] || "",
      yxmc: cells[3] || "",
      teacher: cells[4] || "",
      timePlace: cells[5] || "",
      campus: cells[6] || "",
      hours: cells[7] || "",
      credit: cells[8] || "",
      capacity,
      selected,
      remaining: capacity == null || selected == null ? null : capacity - selected,
    });
  }
  return rows;
}

export async function readCurrentQuotaRows(cookie) {
  const html = await schoolFetch(cookie, "/pyxx/pygl/pyjhxk/dxkc?_=" + Date.now(), {
    headers: {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      Referer: ORIGIN + "/pyxx/pygl/pyjhxk/wsxk",
    },
  });
  if (!/#jhn_tbl|课程编号|预选人数/.test(html)) {
    throw new HttpError(502, "dxkc 返回内容不像选课表格", {
      snippet: html.slice(0, 200).replace(/\s+/g, " "),
    });
  }
  return parseDxkcRows(html);
}

export function formatQuotaResults(targetCourses, quotaRows) {
  return targetCourses.map((course) => {
    const rows = quotaRows.filter((row) => row.kcbh === course.kcbh);
    return {
      course,
      status: rows.length ? "ok" : "missing",
      rows,
      message: rows.length ? "" : "dxkc 未返回该课程",
      updatedAt: new Date().toISOString(),
    };
  });
}

export async function refreshCourses(cookie, codes, options = {}) {
  const targetCourses = getCoursesFromCodes(codes);
  const delayMs = requestDelayMs(options.delayMs);
  await setPlanCourses(cookie, targetCourses, delayMs);
  const quotaRows = await readCurrentQuotaRows(cookie);
  return {
    selectedAfter: await getSelectedExchangeCourses(cookie),
    rows: quotaRows,
    results: formatQuotaResults(targetCourses, quotaRows),
  };
}
