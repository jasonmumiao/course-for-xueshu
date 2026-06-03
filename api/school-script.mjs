import { courses, getCourse, normalizeCourseCodes } from "../lib/courses.mjs";
import { createReportAuthQuery, setSchoolCors } from "../lib/auth.mjs";

function sendJs(req, res, source) {
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/javascript; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  setSchoolCors(req, res);
  res.end(source);
}

function appOrigin(req) {
  const host = req.headers["x-forwarded-host"] || req.headers.host || "";
  const proto = req.headers["x-forwarded-proto"] || (/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(host) ? "http" : "https");
  return `${proto}://${host}`;
}

function parseConfig(req) {
  const url = new URL(req.url, appOrigin(req));
  const mode = url.searchParams.get("mode") || "all";
  const origin = appOrigin(req);
  const codes = normalizeCourseCodes(url.searchParams.get("codes") || "");
  const appUrl = url.searchParams.get("appUrl") || origin + "/";

  const targetCodes = mode === "single" ? codes.filter((code) => getCourse(code)) : [];
  const reportScope = mode === "single" ? targetCodes.join(",") : "all";
  const reportUrl = `${origin}/api/report-cache${createReportAuthQuery(reportScope)}`;

  return {
    mode,
    codes: targetCodes,
    courses,
    reportUrl,
    appUrl,
  };
}

function runnerSource(config) {
  return `(() => {
  "use strict";

  const CONFIG = ${JSON.stringify(config)};
  const COURSE_BY_ID = new Map(CONFIG.courses.map((course) => [String(course.kcbh), course]));
  const state = { logs: [], done: 0, total: 1 };

  function log(message) {
    const line = "[" + new Date().toLocaleTimeString() + "] " + message;
    state.logs.push(line);
    console.log("[学术交流月余量]", message);
    render();
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function ensureSchoolPage() {
    if (!new RegExp("(^|\\\\.)yjsjy\\\\.uestc\\\\.edu\\\\.cn$", "i").test(location.hostname)) {
      throw new Error("请在 yjsjy.uestc.edu.cn 的课程余量页面运行这个书签");
    }
  }

  function getCourse(code) {
    const course = COURSE_BY_ID.get(String(code || "").trim());
    if (!course) throw new Error("未知课程编号：" + code);
    return course;
  }

  async function request(path, options = {}) {
    const response = await fetch(path, {
      credentials: "include",
      cache: "no-store",
      ...options,
      headers: options.headers || {},
    });
    const text = await response.text();
    if (response.redirected || new RegExp("account/login|/pyxx/account/login|统一身份认证").test(text.slice(0, 1000))) {
      throw new Error("学校登录状态失效，请先在当前页面重新登录");
    }
    if (!response.ok) {
      throw new Error("HTTP " + response.status + ": " + text.slice(0, 160));
    }
    return text;
  }

  function normalizeText(value) {
    return String(value == null ? "" : value).replace(/\\s+/g, " ").trim();
  }

  function toNumber(value) {
    const text = String(value ?? "").replace(/,/g, "").replace(/[^\\d.-]/g, "");
    if (!text || text === "-" || text === ".") return null;
    const number = Number(text);
    return Number.isFinite(number) ? number : null;
  }

  function pickHeader(headers, names) {
    const lowered = headers.map((item) => item.toLowerCase());
    for (const name of names) {
      const needle = String(name).toLowerCase();
      const index = lowered.findIndex((item) => item.includes(needle));
      if (index !== -1) return index;
    }
    return -1;
  }

  function firstValue(cells, indices) {
    for (const index of indices) {
      if (index >= 0 && cells[index]) return cells[index];
    }
    return "";
  }

  function pickField(obj, names) {
    if (!obj || typeof obj !== "object") return undefined;
    const lower = {};
    Object.keys(obj).forEach((key) => {
      lower[key.toLowerCase()] = key;
    });
    for (const name of names) {
      if (Object.prototype.hasOwnProperty.call(obj, name)) return obj[name];
      const key = lower[String(name).toLowerCase()];
      if (key) return obj[key];
    }
    return undefined;
  }

  function normalizeApiRows(data) {
    if (typeof data === "string") {
      try {
        return normalizeApiRows(JSON.parse(data));
      } catch {
        return [];
      }
    }
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data.aaData)) return data.aaData;
    if (data && Array.isArray(data.data)) return data.data;
    if (data && Array.isArray(data.rows)) return data.rows;
    return [];
  }

  function rowObjectFromApi(raw) {
    const code = String(pickField(raw, ["KCBH", "kcbh", "课程编号"]) || "").trim();
    const course = COURSE_BY_ID.get(code);
    if (!course) return null;

    const capacity = toNumber(pickField(raw, ["RNRS", "rnrs", "RNRS1", "RLRS", "容量", "容纳人数", "总量"]));
    const selected = toNumber(pickField(raw, ["XKRS", "xkrs", "YXRS", "预选人数", "选课人数", "已选人数"]));
    const apiRemaining = toNumber(pickField(raw, ["SYRS", "剩余人数", "余量"]));
    const remaining = apiRemaining == null && capacity != null && selected != null ? capacity - selected : apiRemaining;

    return {
      bjid: String(pickField(raw, ["BJID", "bjid", "JXBID"]) || ""),
      kcbh: course.kcbh,
      name: String(pickField(raw, ["KCBJMC", "kcbjmc", "KCMC", "课程名称"]) || course.kcmc + "——" + (course.lb || "")),
      yxmc: String(pickField(raw, ["XSMC", "xsmc", "YXMC", "开课学院"]) || course.yxmc || ""),
      teacher: String(pickField(raw, ["JSXM", "jsxm", "RKJS", "任课教师"]) || ""),
      timePlace: String(pickField(raw, ["SKSJ", "sksj", "SKSJDD", "上课时间"]) || ""),
      campus: String(pickField(raw, ["XQ", "xq", "开课校区"]) || ""),
      hours: String(pickField(raw, ["KCZXS", "kczxs", "学时"]) || course.kczxs || ""),
      credit: String(pickField(raw, ["KCXF", "kcxf", "学分"]) || course.kcxf || ""),
      capacity,
      selected,
      remaining,
    };
  }

  function numberValue(cells, indices) {
    const value = firstValue(cells, indices);
    return value ? toNumber(value) : null;
  }

  function detectCourseCode(cells) {
    for (const text of cells) {
      const compact = String(text || "").replace(/\\s+/g, "");
      for (const code of COURSE_BY_ID.keys()) {
        if (compact.includes(code)) return code;
      }
    }
    return "";
  }

  function rowObjectFromCells(cells, headers) {
    const codeIndices = [pickHeader(headers, ["课程编号", "课程代码", "kcbh", "编号"])];
    const classIndices = [pickHeader(headers, ["班级ID", "教学班ID", "bjid"])];
    const nameIndices = [pickHeader(headers, ["班级名称", "教学班", "班级", "课程名称", "课程名"])];
    const departmentIndices = [pickHeader(headers, ["开课院系", "院系", "学院"])];
    const teacherIndices = [pickHeader(headers, ["任课教师", "教师", "老师"])];
    const timeIndices = [pickHeader(headers, ["上课时间地点", "时间地点", "上课时间", "上课安排", "时间"])];
    const campusIndices = [pickHeader(headers, ["校区"])];
    const hoursIndices = [pickHeader(headers, ["学时"])];
    const creditIndices = [pickHeader(headers, ["学分"])];
    const capacityIndices = [pickHeader(headers, ["课容量", "容量", "总人数", "总量", "限选人数", "计划人数", "人数上限"])];
    const selectedIndices = [pickHeader(headers, ["预选人数", "已选人数", "选课人数", "报名人数", "预选", "已选"])];
    const remainingIndices = [pickHeader(headers, ["剩余人数", "剩余名额", "余量", "剩余", "可选"])];

    const code = firstValue(cells, codeIndices) || detectCourseCode(cells);
    const course = COURSE_BY_ID.get(String(code || "").trim());
    if (!course) return null;

    let capacity = numberValue(cells, capacityIndices);
    let selected = numberValue(cells, selectedIndices);
    let remaining = numberValue(cells, remainingIndices);
    if (remaining == null && capacity != null && selected != null) remaining = capacity - selected;
    if (selected == null && capacity != null && remaining != null) selected = capacity - remaining;
    if (capacity == null && selected != null && remaining != null) capacity = selected + remaining;

    return {
      bjid: firstValue(cells, classIndices),
      kcbh: course.kcbh,
      name: firstValue(cells, nameIndices) || course.kcmc + "——" + (course.lb || ""),
      yxmc: firstValue(cells, departmentIndices) || course.yxmc || "",
      teacher: firstValue(cells, teacherIndices),
      timePlace: firstValue(cells, timeIndices),
      campus: firstValue(cells, campusIndices),
      hours: firstValue(cells, hoursIndices) || String(course.kczxs || ""),
      credit: firstValue(cells, creditIndices) || String(course.kcxf || ""),
      capacity,
      selected,
      remaining,
    };
  }

  function parseTable(table) {
    const rows = Array.from(table.querySelectorAll("tr"));
    let headerIndex = rows.findIndex((row) => {
      const texts = Array.from(row.children).map((cell) => normalizeText(cell.textContent));
      const joined = texts.join(" ");
      return /课程|编号|容量|余量|预选|已选|剩余/.test(joined);
    });
    if (headerIndex === -1) headerIndex = 0;

    const headers = Array.from(rows[headerIndex]?.children || []).map((cell) => normalizeText(cell.textContent));
    const parsed = [];
    for (let index = headerIndex + 1; index < rows.length; index += 1) {
      const cells = Array.from(rows[index].querySelectorAll("td")).map((cell) => normalizeText(cell.textContent));
      if (!cells.length) continue;
      const row = rowObjectFromCells(cells, headers);
      if (row) parsed.push(row);
    }
    return parsed;
  }

  function parseKbcxRows(html) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const rows = [];
    for (const table of Array.from(doc.querySelectorAll("table"))) {
      rows.push(...parseTable(table));
    }

    const seen = new Set();
    return rows.filter((row) => {
      const key = [row.kcbh, row.bjid, row.name, row.teacher, row.timePlace, row.capacity, row.selected, row.remaining].join("|");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function kbcxParams(kclbm) {
    return new URLSearchParams({
      sEcho: "1",
      iColumns: "10",
      sColumns: "",
      iDisplayStart: "0",
      iDisplayLength: "1000",
      mDataProp_0: "KCBH",
      mDataProp_1: "KCBJMC",
      mDataProp_2: "JSXM",
      mDataProp_3: "XSMC",
      mDataProp_4: "XQ",
      mDataProp_5: "KCZXS",
      mDataProp_6: "KCXF",
      mDataProp_7: "SKSJ",
      mDataProp_8: "RNRS",
      mDataProp_9: "XKRS",
      yxsh: "",
      kclbm,
      jsbhxm: "",
      kcbhmc: "",
      _: String(Date.now()),
    });
  }

  async function readKbcxApiRows() {
    const rows = [];
    let failures = 0;
    for (const kclbm of ["10", "11"]) {
      try {
        const text = await request("/pyxx/pygl/pyjhxk/kbcx/page?" + kbcxParams(kclbm).toString(), {
          method: "GET",
          headers: {
            Accept: "application/json, text/javascript, */*; q=0.01",
            "X-Requested-With": "XMLHttpRequest",
          },
        });
        const data = JSON.parse(text);
        const categoryRows = normalizeApiRows(data).map(rowObjectFromApi).filter(Boolean);
        log((kclbm === "10" ? "A类" : "B类") + "接口返回 " + categoryRows.length + " 条。");
        rows.push(...categoryRows);
      } catch (error) {
        failures += 1;
        log((kclbm === "10" ? "A类" : "B类") + "接口读取失败，准备尝试页面表格解析：" + (error && error.message ? error.message : String(error)));
      }
    }
    return { rows, failures };
  }

  async function readKbcxQuotaRows() {
    const apiResult = await readKbcxApiRows();
    if (apiResult.rows.length && apiResult.failures === 0) return dedupeRows(apiResult.rows);

    const html = await request("/pyxx/pygl/pyjhxk/kbcx?_=" + Date.now(), {
      method: "GET",
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
    const rows = parseKbcxRows(html);
    const combined = dedupeRows([...apiResult.rows, ...rows]);
    if (!combined.length) {
      throw new Error("未能从 kbcx 页面解析到课程余量表格。请在浏览器网络面板导出 kbcx 页面刷新时的 HAR。");
    }
    if (apiResult.failures) log("页面表格补充解析 " + rows.length + " 条。");
    return combined;
  }

  function dedupeRows(rows) {
    const seen = new Set();
    return rows.filter((row) => {
      const key = [row.kcbh, row.bjid, row.name, row.teacher, row.timePlace, row.capacity, row.selected, row.remaining].join("|");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function formatResults(targetCourses, quotaRows) {
    const updatedAt = new Date().toISOString();
    return targetCourses.map((course) => {
      const rows = quotaRows.filter((row) => row.kcbh === course.kcbh);
      return {
        course,
        status: rows.length ? "ok" : "missing",
        rows,
        message: rows.length ? "" : "kbcx 未返回该课程",
        updatedAt,
      };
    });
  }

  async function reportResults(results, meta) {
    const response = await fetch(CONFIG.reportUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      body: JSON.stringify({
        source: "uestc-course-quota-report",
        version: 1,
        results,
        meta,
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) {
      throw new Error("回传看板失败：" + (data.error || response.status));
    }
    return data;
  }

  function render() {
    let root = document.getElementById("uestc-quota-runner");
    if (!root) {
      root = document.createElement("div");
      root.id = "uestc-quota-runner";
      root.style.cssText = "position:fixed;inset:16px;z-index:2147483647;background:#fff;border:1px solid #ccd5e0;border-radius:8px;box-shadow:0 20px 50px rgba(15,23,42,.25);font:14px/1.5 -apple-system,BlinkMacSystemFont,'Microsoft YaHei',sans-serif;color:#172033;display:grid;grid-template-rows:auto auto 1fr auto;overflow:hidden";
      document.body.appendChild(root);
    }
    const progress = state.total ? Math.round((state.done / state.total) * 100) : 0;
    root.innerHTML =
      '<div style="padding:14px 16px;border-bottom:1px solid #d7dee8;display:flex;justify-content:space-between;gap:12px;align-items:center">' +
        '<div><strong>学术交流月余量刷新</strong><div style="font-size:12px;color:#667085">直接读取 kbcx 页面，不会修改培养方案</div></div>' +
        '<div style="font-size:12px;color:#667085">' + state.done + '/' + state.total + '</div>' +
      '</div>' +
      '<div style="height:8px;background:#e9eef5"><div style="height:100%;width:' + progress + '%;background:#0b6bcb"></div></div>' +
      '<pre style="margin:0;padding:12px 16px;overflow:auto;white-space:pre-wrap;font:12px/1.6 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace">' + escapeHtml(state.logs.slice(-200).join("\\n")) + '</pre>' +
      '<div style="padding:10px 16px;border-top:1px solid #d7dee8;color:#667085;font-size:12px">请不要关闭本页。读取完成后会自动回到看板。</div>';
  }

  async function run() {
    ensureSchoolPage();
    render();
    const targetCourses = CONFIG.mode === "single"
      ? CONFIG.codes.map(getCourse)
      : CONFIG.courses;

    log("开始读取 kbcx 课程余量页面。");
    const quotaRows = await readKbcxQuotaRows();
    log("已解析到 " + quotaRows.length + " 条课程/班级记录。");

    const results = formatResults(targetCourses, quotaRows);
    await reportResults(results, {
      mode: CONFIG.mode,
      sourcePage: "kbcx",
      parsedRows: quotaRows.length,
    });
    state.done = 1;
    render();
    log("结果已回传看板，准备返回。");
    location.href = CONFIG.appUrl + "?updated=" + Date.now();
  }

  run().catch((error) => {
    log("失败：" + (error && error.message ? error.message : String(error)));
    console.error("[学术交流月余量] 运行失败", error);
    alert("运行失败：" + (error && error.message ? error.message : String(error)));
  });
})();`;
}

export default async function handler(req, res) {
  try {
    sendJs(req, res, runnerSource(parseConfig(req)));
  } catch (error) {
    sendJs(req, res, `alert(${JSON.stringify("加载脚本失败：" + (error?.message || String(error)))})`);
  }
}
