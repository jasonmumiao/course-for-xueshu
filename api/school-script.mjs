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
  const restoreCodes = normalizeCourseCodes(url.searchParams.get("restore") || "");
  const delayMs = Number(url.searchParams.get("delayMs") || "900") || 900;
  const appUrl = url.searchParams.get("appUrl") || origin + "/";

  const targetCodes = mode === "single" ? codes.filter((code) => getCourse(code)) : [];
  const reportScope = mode === "single" ? targetCodes.join(",") : "all";
  const reportUrl = `${origin}/api/report-cache${createReportAuthQuery(reportScope)}`;

  return {
    mode,
    codes: targetCodes,
    courses,
    restoreCodes: restoreCodes.filter((code) => getCourse(code)),
    delayMs,
    reportUrl,
    appUrl,
  };
}

function runnerSource(config) {
  return `(() => {
  "use strict";

  const CONFIG = ${JSON.stringify(config)};
  const BXHJ_PLACEHOLDER = "XX0003XXXX";
  const COURSE_BY_ID = new Map(CONFIG.courses.map((course) => [String(course.kcbh), course]));
  const state = { logs: [], done: 0, total: 0 };

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function log(message) {
    const line = "[" + new Date().toLocaleTimeString() + "] " + message;
    state.logs.push(line);
    console.log("[学术交流月余量]", message);
    render();
  }

  function normalizeResponseText(text) {
    return String(text == null ? "" : text).trim().replace(/^"|"$/g, "");
  }

  function ensureSchoolPage() {
    if (!new RegExp("(^|\\\\.)yjsjy\\\\.uestc\\\\.edu\\\\.cn$", "i").test(location.hostname)) {
      throw new Error("请在 yjsjy.uestc.edu.cn 的培养方案或选课页面运行这个书签");
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

  async function getExchangeList() {
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
    const text = await request("/pyxx/pygl/kckk/bxhjlist?" + params.toString(), {
      method: "GET",
      headers: {
        Accept: "application/json, text/javascript, */*; q=0.01",
        "X-Requested-With": "XMLHttpRequest",
      },
    });
    const data = JSON.parse(text);
    return Array.isArray(data.aaData) ? data.aaData : [];
  }

  async function getSelectedExchangeCourses() {
    const rows = await getExchangeList();
    return rows
      .filter((row) => String(row.SFYX ?? "0") !== "0")
      .map((row) => COURSE_BY_ID.get(String(row.KCBH)) || {
        kcbh: String(row.KCBH || ""),
        kcmc: String(row.KCMC || ""),
        yxmc: String(row.YXMC || ""),
        lb: String(row.LB || ""),
        kclbm: String(row.KCLBM || ""),
        sfbfa: String(row.SFBFA || "2"),
      });
  }

  async function deleteCourse(course) {
    const body = new URLSearchParams({ kcbh: course.kcbh, kcbhs: course.kcbh });
    return normalizeResponseText(await request("/pyxx/pygl/pyjhtj/deletekc", {
      method: "POST",
      headers: {
        Accept: "application/json, text/javascript, */*; q=0.01",
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest",
      },
      body: body.toString(),
    }));
  }

  async function addCourse(course) {
    const body = new URLSearchParams({
      kcbh: course.kcbh,
      kclx: course.kclbm,
      sfbfa: course.sfbfa || "2",
    });
    const result = normalizeResponseText(await request("/pyxx/pygl/pyjhtj/zjbxhjkc", {
      method: "POST",
      headers: {
        Accept: "application/json, text/javascript, */*; q=0.01",
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest",
      },
      body: body.toString(),
    }));
    if (result !== "1") {
      throw new Error("添加 " + course.kcbh + " 返回 " + (result || "(空)"));
    }
  }

  async function setPlanCourses(targetCourses, delayMs) {
    const selected = await getSelectedExchangeCourses();
    if (selected.length) log("删除当前培养方案课程：" + selected.map((course) => course.kcbh).join(", "));
    for (const course of selected) {
      await deleteCourse(course);
      await sleep(Math.max(200, Math.floor(delayMs / 3)));
    }

    if (targetCourses.length) log("添加培养方案课程：" + targetCourses.map((course) => course.kcbh).join(", "));
    for (const course of targetCourses) {
      await addCourse(course);
      await sleep(Math.max(200, Math.floor(delayMs / 3)));
    }
    await sleep(delayMs);
    return getSelectedExchangeCourses();
  }

  function parseDxkcRows(html) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    return Array.from(doc.querySelectorAll("#jhn_tbl tr[id^='tr_jhn_']")).map((row) => {
      const cells = Array.from(row.querySelectorAll("td"));
      const text = (index) => (cells[index]?.textContent || "").replace(/\\s+/g, " ").trim();
      const capacity = Number(text(9));
      const selected = Number(text(10));
      return {
        bjid: text(0),
        kcbh: text(1),
        name: text(2),
        yxmc: text(3),
        teacher: text(4),
        timePlace: text(5),
        campus: text(6),
        hours: text(7),
        credit: text(8),
        capacity: Number.isFinite(capacity) ? capacity : null,
        selected: Number.isFinite(selected) ? selected : null,
        remaining: Number.isFinite(capacity) && Number.isFinite(selected) ? capacity - selected : null,
      };
    });
  }

  async function readCurrentQuotaRows() {
    const html = await request("/pyxx/pygl/pyjhxk/dxkc?_=" + Date.now(), {
      method: "GET",
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
    if (!/#jhn_tbl|课程编号|预选人数/.test(html)) {
      throw new Error("dxkc 返回内容不像选课表格：" + html.slice(0, 120).replace(/\\s+/g, " "));
    }
    return parseDxkcRows(html);
  }

  function formatResults(targetCourses, quotaRows) {
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

  function pairsFromCodes(codes) {
    const pairs = [];
    for (let index = 0; index < codes.length; index += 2) {
      pairs.push(codes.slice(index, index + 2).map(getCourse));
    }
    return pairs;
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
        '<div><strong>学术交流月余量刷新</strong><div style="font-size:12px;color:#667085">在学校页面同源执行，结束后自动恢复培养方案并回到看板</div></div>' +
        '<div style="font-size:12px;color:#667085">' + state.done + '/' + state.total + '</div>' +
      '</div>' +
      '<div style="height:8px;background:#e9eef5"><div style="height:100%;width:' + progress + '%;background:#0b6bcb"></div></div>' +
      '<pre style="margin:0;padding:12px 16px;overflow:auto;white-space:pre-wrap;font:12px/1.6 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace">' + state.logs.slice(-200).join('\\n') + '</pre>' +
      '<div style="padding:10px 16px;border-top:1px solid #d7dee8;color:#667085;font-size:12px">请不要关闭本页。若中断，请手动检查培养方案是否恢复。</div>';
  }

  async function run() {
    ensureSchoolPage();
    render();
    const delayMs = Number(CONFIG.delayMs) || 900;
    const initialSelected = await getSelectedExchangeCourses();
    const restoreCourses = CONFIG.restoreCodes.length
      ? CONFIG.restoreCodes.map(getCourse)
      : initialSelected;
    log("当前培养方案课程：" + (initialSelected.length ? initialSelected.map((course) => course.kcbh).join(", ") : "无"));
    log("最终恢复课程：" + (restoreCourses.length ? restoreCourses.map((course) => course.kcbh).join(", ") : "无"));

    if (CONFIG.mode === "restore") {
      state.total = 1;
      await setPlanCourses(restoreCourses, delayMs);
      state.done = 1;
      log("恢复完成，准备回到看板。");
      location.href = CONFIG.appUrl + "?updated=" + Date.now();
      return;
    }

    const targetCodes = CONFIG.mode === "single"
      ? CONFIG.codes
      : CONFIG.courses.map((course) => course.kcbh);
    const pairs = pairsFromCodes(targetCodes);
    state.total = pairs.length;
    render();

    try {
      for (let index = 0; index < pairs.length; index += 1) {
        const pair = pairs[index];
        log("第 " + (index + 1) + "/" + pairs.length + " 组：" + pair.map((course) => course.kcbh).join(", "));
        await setPlanCourses(pair, delayMs);
        const quotaRows = await readCurrentQuotaRows();
        const results = formatResults(pair, quotaRows);
        await reportResults(results, {
          mode: CONFIG.mode,
          group: index + 1,
          total: pairs.length,
          restoreCodes: restoreCourses.map((course) => course.kcbh),
          initialSelected,
        });
        state.done = index + 1;
        render();
        await sleep(delayMs);
      }
      log("所有结果已回传看板。");
    } finally {
      log("开始恢复培养方案。");
      await setPlanCourses(restoreCourses, delayMs);
      log("培养方案已恢复。");
    }

    log("完成，准备跳回看板。");
    location.href = CONFIG.appUrl + "?updated=" + Date.now();
  }

  run().catch((error) => {
    log("失败：" + (error && error.message ? error.message : String(error)));
    console.error("[学术交流月余量] 运行失败", error);
    alert("运行失败：" + (error && error.message ? error.message : String(error)) + "\\n请检查培养方案是否已恢复。");
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
