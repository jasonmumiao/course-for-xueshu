const state = {
  delayMs: Number(localStorage.getItem("delayMs") || "300"),
  cacheUpdatedAt: "",
  storage: null,
  query: "",
  category: "all",
  availability: "all",
  conflictFilter: "all",
  sortKey: localStorage.getItem("sortKey") || "remaining",
  sortDir: localStorage.getItem("sortDir") || "desc",
  pendingCodes: JSON.parse(localStorage.getItem("pendingCourseCodes") || "[]"),
  courses: [],
  categories: [],
  results: new Map(),
  message: "",
  error: "",
  pendingRefresh: null,
};

const app = document.getElementById("app");
const SCHOOL_PLAN_URL = "https://yjsjy.uestc.edu.cn/pyxx/pygl/pyjhtj/index2?nd=2025&kclb=&kcbh=%E7%A0%94%E7%A9%B6%E7%94%9F&sfbfa=1";
const GITHUB_REPO_URL = "https://github.com/jasonmumiao/course-for-xueshu";

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function saveSettings() {
  localStorage.setItem("delayMs", String(state.delayMs));
  localStorage.setItem("sortKey", state.sortKey);
  localStorage.setItem("sortDir", state.sortDir);
  localStorage.setItem("pendingCourseCodes", JSON.stringify(state.pendingCodes));
}

async function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const input = document.createElement("textarea");
  input.value = text;
  input.style.position = "fixed";
  input.style.left = "-9999px";
  document.body.appendChild(input);
  input.select();
  document.execCommand("copy");
  input.remove();
}

function isLocalPreview() {
  return /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(window.location.host);
}

function appUrl() {
  return window.location.origin + window.location.pathname;
}

function buildSchoolScriptUrl(mode, codes = [], delayMs = state.delayMs) {
  const url = new URL("/api/school-script", window.location.origin);
  url.searchParams.set("mode", mode);
  if (codes.length) url.searchParams.set("codes", codes.join(","));
  url.searchParams.set("delayMs", String(delayMs));
  url.searchParams.set("appUrl", appUrl());
  return url.toString();
}

function buildSchoolLoaderScript(mode, codes = [], delayMs = state.delayMs) {
  const scriptUrl = buildSchoolScriptUrl(mode, codes, delayMs);
  const label = mode === "all" ? "全量刷新" : "单门刷新";
  return `(async()=>{if(!/(^|\\.)yjsjy\\.uestc\\.edu\\.cn$/i.test(location.hostname)){alert("请先打开学校培养方案页面，再点击这个书签。");return}const u=${JSON.stringify(scriptUrl)};alert(${JSON.stringify(label + "脚本开始加载。稍后会出现进度面板，请不要关闭页面。")});const byScript=(msg)=>{const old=document.getElementById("uestc-quota-remote-script");if(old)old.remove();const s=document.createElement("script");s.id="uestc-quota-remote-script";s.src=u+(u.includes("?")?"&":"?")+"_t="+Date.now();s.async=true;s.onerror=()=>alert("脚本加载失败："+(msg||"请重新生成书签后再试"));(document.head||document.documentElement).appendChild(s)};try{const r=await fetch(u,{cache:"no-store"});const c=await r.text();if(!r.ok)throw new Error("HTTP "+r.status+" "+c.slice(0,80));try{(0,eval)(c)}catch(e){console.warn("[学术交流月余量] eval 被拦截，改用 script 标签加载",e);byScript(e.message)}}catch(e){console.warn("[学术交流月余量] fetch 失败，改用 script 标签加载",e);byScript(e.message)}})();`;
}

function bookmarkletHref(mode, codes = [], delayMs = state.delayMs) {
  return "javascript:" + buildSchoolLoaderScript(mode, codes, delayMs);
}

function refreshLabel(mode, codes = []) {
  if (mode === "all") return "刷新全部课程";
  const course = codes.length ? state.courses.find((item) => item.kcbh === codes[0]) : null;
  return course ? "刷新：" + course.kcmc : "刷新单门课程";
}

function openRefreshDialog(mode, codes = []) {
  if (!state.courses.length) {
    state.error = "课程目录还没有加载完成";
    render();
    return;
  }
  if (mode === "single" && !codes.length) {
    state.error = "请先选择一门课程";
    render();
    return;
  }
  state.pendingRefresh = {
    mode,
    codes,
    label: refreshLabel(mode, codes),
  };
  state.message = "";
  state.error = "";
  render();
}

async function copyPendingBookmarklet() {
  if (!state.pendingRefresh) return;
  const href = bookmarkletHref(state.pendingRefresh.mode, state.pendingRefresh.codes);
  await copyText(href);
  state.message = "书签地址已复制。更推荐直接把弹窗里的书签按钮拖到浏览器书签栏。";
  render();
}

function closeRefreshDialog() {
  state.pendingRefresh = null;
  render();
}

function goSchoolAfterBookmark() {
  if (!state.pendingRefresh) return;
  window.open(SCHOOL_PLAN_URL, "_blank");
  state.message = "学校页面已打开。登录后点击你刚拖好的书签，刷新结果会回传到当前看板。";
  render();
}

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(path, {
    ...options,
    headers,
    body: options.body && typeof options.body !== "string" ? JSON.stringify(options.body) : options.body,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    throw new Error(data.error || "请求失败");
  }
  return data;
}

function statusText(result) {
  if (!result) return "未刷新";
  if (result.status === "ok") return "已获取";
  if (result.status === "missing") return "无数据";
  if (result.status === "error") return result.message || "失败";
  return result.status || "未知";
}

function firstQuota(result) {
  return result?.rows?.[0] || null;
}

function courseByCode(code) {
  return state.courses.find((course) => course.kcbh === code);
}

function selectedCourses() {
  return state.pendingCodes.map(courseByCode).filter(Boolean);
}

function uniquePendingCodes(codes) {
  const known = new Set(state.courses.map((course) => course.kcbh));
  return [...new Set(codes)].filter((code) => known.has(code));
}

function parseScheduleSlots(text) {
  const source = String(text || "").replace(/\s+/g, " ").trim();
  if (!source) return [];

  const slots = [];
  const weekMatches = [...source.matchAll(/(\d+)\s*[-－~～]\s*(\d+)\s*周/g)];
  if (weekMatches.length) {
    weekMatches.forEach((match, index) => {
      const next = weekMatches[index + 1];
      const segment = source.slice(match.index, next?.index ?? source.length);
      pushDaySlots(slots, segment, Number(match[1]), Number(match[2]));
    });
  } else {
    pushDaySlots(slots, source, 0, 99);
  }
  return slots;
}

function pushDaySlots(slots, text, weekStart, weekEnd) {
  const dayMap = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7 };
  const matches = text.matchAll(/星期([一二三四五六日天])\s*第\s*(\d+)(?:\s*[-－~～]\s*(\d+))?\s*节/g);
  for (const match of matches) {
    const start = Number(match[2]);
    const end = Number(match[3] || match[2]);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    slots.push({
      weekStart: Math.min(weekStart, weekEnd),
      weekEnd: Math.max(weekStart, weekEnd),
      day: dayMap[match[1]],
      start: Math.min(start, end),
      end: Math.max(start, end),
    });
  }
}

function courseSlots(course) {
  const result = state.results.get(course.kcbh);
  return (result?.rows || []).flatMap((row) => parseScheduleSlots(row.timePlace));
}

function slotsOverlap(a, b) {
  return a.day === b.day
    && a.weekStart <= b.weekEnd
    && b.weekStart <= a.weekEnd
    && a.start <= b.end
    && b.start <= a.end;
}

function coursesConflict(a, b) {
  const left = courseSlots(a);
  const right = courseSlots(b);
  if (!left.length || !right.length) return false;
  return left.some((slot) => right.some((other) => slotsOverlap(slot, other)));
}

function selectability(course) {
  const selected = state.pendingCodes.includes(course.kcbh);
  const quota = firstQuota(state.results.get(course.kcbh));
  const full = quota?.remaining != null && quota.remaining <= 0;
  const hasTime = courseSlots(course).length > 0;
  const conflicts = selectedCourses().some((item) => item.kcbh !== course.kcbh && coursesConflict(course, item));

  if (selected) return { selected, conflicts, full, hasTime, label: conflicts ? "已加入，冲突" : "已加入" };
  if (full) return { selected, conflicts, full, hasTime, label: "已满" };
  if (conflicts) return { selected, conflicts, full, hasTime, label: "时间冲突" };
  if (!hasTime) return { selected, conflicts, full, hasTime, label: "时间未知" };
  return { selected, conflicts, full, hasTime, label: "可加入" };
}

function conflictCount() {
  return state.pendingCodes.filter((code) => {
    const course = courseByCode(code);
    return course && selectability(course).conflicts;
  }).length;
}

function metrics() {
  let ok = 0;
  let missing = 0;
  let errors = 0;
  let totalRemain = 0;
  let known = 0;

  for (const course of state.courses) {
    const result = state.results.get(course.kcbh);
    if (!result) continue;
    if (result.status === "ok") ok += 1;
    if (result.status === "missing") missing += 1;
    if (result.status === "error") errors += 1;
    const quota = firstQuota(result);
    if (quota && quota.remaining != null) {
      known += 1;
      totalRemain += quota.remaining;
    }
  }

  return { ok, missing, errors, known, totalRemain };
}

function sortValue(course, key) {
  const result = state.results.get(course.kcbh);
  const quota = firstQuota(result);
  if (key === "name") return course.kcmc || "";
  if (key === "capacity") return quota?.capacity;
  if (key === "selected") return quota?.selected;
  if (key === "remaining") return quota?.remaining;
  if (key === "updatedAt") return result?.updatedAt ? Date.parse(result.updatedAt) : null;
  return course.rownum || 0;
}

function compareCourses(a, b) {
  const av = sortValue(a, state.sortKey);
  const bv = sortValue(b, state.sortKey);
  const dir = state.sortDir === "asc" ? 1 : -1;

  if (typeof av === "string" || typeof bv === "string") {
    return String(av || "").localeCompare(String(bv || ""), "zh-Hans-CN") * dir;
  }

  const an = av == null || Number.isNaN(av) ? (state.sortDir === "asc" ? Infinity : -Infinity) : av;
  const bn = bv == null || Number.isNaN(bv) ? (state.sortDir === "asc" ? Infinity : -Infinity) : bv;
  if (an === bn) return (a.rownum || 0) - (b.rownum || 0);
  return (an - bn) * dir;
}

function filteredCourses() {
  const query = state.query.trim().toLowerCase();
  return state.courses.filter((course) => {
    const result = state.results.get(course.kcbh);
    const quota = firstQuota(result);
    const haystack = [
      course.kcbh,
      course.kcmc,
      course.yxmc,
      course.lb,
      course.kclx,
      quota?.teacher,
      quota?.timePlace,
    ].join(" ").toLowerCase();

    if (query && !haystack.includes(query)) return false;
    if (state.category !== "all" && course.lb !== state.category) return false;
    if (state.availability === "hasRemain" && !(quota && quota.remaining != null && quota.remaining > 0)) return false;
    if (state.availability === "full" && !(quota && quota.remaining != null && quota.remaining <= 0)) return false;
    if (state.availability === "unknown" && !(result?.status === "missing" || (result?.status === "ok" && (!quota || quota.remaining == null)))) return false;
    if (state.availability === "error" && result?.status !== "error") return false;
    const selection = selectability(course);
    if (state.conflictFilter === "conflict" && !selection.conflicts) return false;
    if (state.conflictFilter === "clear" && selection.conflicts) return false;
    return true;
  }).sort(compareCourses);
}

function sortButton(label, key, extraClass = "") {
  const active = state.sortKey === key;
  const arrow = active ? (state.sortDir === "asc" ? "↑" : "↓") : "↕";
  return `<button class="sort-btn ${extraClass} ${active ? "active" : ""}" data-sort="${escapeHtml(key)}">${escapeHtml(label)} <span>${arrow}</span></button>`;
}

function render() {
  const m = metrics();
  const rows = filteredCourses();
  const cacheLabel = state.cacheUpdatedAt ? new Date(state.cacheUpdatedAt).toLocaleString() : "暂无快照";
  const storageLabel = state.storage?.persistent ? "持久缓存" : "临时缓存";
  const selected = selectedCourses();
  const conflictTotal = conflictCount();
  const searchHint = state.query.trim()
    ? `当前搜索匹配 ${rows.length} 门`
    : "输入课程名或编号后，可用右侧按钮刷新单门";

  app.innerHTML = `
    <header class="topbar">
      <div class="topbar-inner">
        <div class="title-row">
          <div>
            <h1>学术交流月余量看板</h1>
            <div class="muted">课程 ${state.courses.length} 门；快照 ${escapeHtml(cacheLabel)}；${escapeHtml(storageLabel)}</div>
          </div>
          <div class="header-actions">
            <a class="repo-link" href="${GITHUB_REPO_URL}" target="_blank" rel="noreferrer">GitHub 仓库</a>
            <button id="refreshAll" class="primary-action">刷新全部</button>
          </div>
        </div>

        <section class="guide">
          <div>
            <b>1. 查看快照</b>
            <span>首页直接显示上一次刷新结果。</span>
          </div>
          <div>
            <b>2. 选择刷新</b>
            <span>刷新全部，或搜索到单门后刷新。</span>
          </div>
          <div>
            <b>3. 拖书签运行</b>
            <span>弹窗中设置间隔，拖好书签再跳转学校页面。</span>
          </div>
        </section>

        <section class="action-panel">
          <div class="search-refresh">
            <label>搜索单门课程
              <input id="query" value="${escapeHtml(state.query)}" placeholder="课程名、编号、院系、教师">
            </label>
            <button id="refreshSearch" class="secondary">刷新搜索结果</button>
            <div class="muted">${escapeHtml(searchHint)}</div>
          </div>

          <div class="filters">
            <select id="category">
              <option value="all">全部类别</option>
              ${state.categories.map((item) => `<option value="${escapeHtml(item)}" ${state.category === item ? "selected" : ""}>${escapeHtml(item)}</option>`).join("")}
            </select>
            <select id="availability">
              <option value="all" ${state.availability === "all" ? "selected" : ""}>全部状态</option>
              <option value="hasRemain" ${state.availability === "hasRemain" ? "selected" : ""}>有余量</option>
              <option value="full" ${state.availability === "full" ? "selected" : ""}>已满/超额</option>
              <option value="unknown" ${state.availability === "unknown" ? "selected" : ""}>余量未知</option>
              <option value="error" ${state.availability === "error" ? "selected" : ""}>请求失败</option>
            </select>
            <select id="conflictFilter">
              <option value="all" ${state.conflictFilter === "all" ? "selected" : ""}>全部冲突状态</option>
              <option value="clear" ${state.conflictFilter === "clear" ? "selected" : ""}>不冲突</option>
              <option value="conflict" ${state.conflictFilter === "conflict" ? "selected" : ""}>有冲突</option>
            </select>
            <button id="export" class="secondary">导出 CSV</button>
          </div>

          <div class="pending-panel">
            <div>
              <b>待选 ${selected.length} 门</b>
              <span class="muted">${conflictTotal ? `其中 ${conflictTotal} 门存在时间冲突` : "未发现时间冲突"}</span>
            </div>
            <div class="pending-list">
              ${selected.length ? selected.map((course) => `<button class="pending-chip ${selectability(course).conflicts ? "conflict" : ""}" data-remove-pending="${escapeHtml(course.kcbh)}">${escapeHtml(course.kcmc)}</button>`).join("") : `<span class="muted">点击表格里的“加入待选”开始模拟。</span>`}
            </div>
            <button id="clearPending" class="secondary" ${selected.length ? "" : "disabled"}>清空待选</button>
          </div>
        </section>
      </div>
    </header>

    <section class="summary">
      <div class="metric"><span class="muted">快照课程</span><b>${m.ok}/${state.courses.length}</b></div>
      <div class="metric"><span class="muted">可计算余量</span><b>${m.known}</b></div>
      <div class="metric"><span class="muted">合计余量</span><b>${m.known ? m.totalRemain : "--"}</b></div>
      <div class="metric"><span class="muted">无数据</span><b>${m.missing}</b></div>
      <div class="metric"><span class="muted">待选/冲突</span><b>${selected.length}/${conflictTotal}</b></div>
      <div class="metric"><span class="muted">失败</span><b>${m.errors}</b></div>
    </section>

    ${state.error ? `<div class="notice bad-notice">${escapeHtml(state.error)}</div>` : ""}
    ${state.message ? `<div class="notice">${escapeHtml(state.message)}</div>` : ""}

    <main class="content">
      <div class="button-row">
        <div class="muted">当前显示 ${rows.length} 门；点击表头可升序/降序排序</div>
      </div>
      ${rows.length ? renderTable(rows) : `<div class="empty">没有匹配的课程</div>`}
    </main>
    ${state.pendingRefresh ? renderRefreshModal(state.pendingRefresh) : ""}
  `;

  bindEvents();
}

function renderRefreshModal(modal) {
  const href = bookmarkletHref(modal.mode, modal.codes);
  const target = window.location.origin;
  const localWarning = isLocalPreview()
    ? `<div class="modal-warning">当前是本地预览，结果会回传到 <code>${escapeHtml(target)}</code>。要更新 Vercel 正式站，请从 Vercel 网址重新生成并拖放书签。</div>`
    : `<div class="modal-target">结果会回传到 <code>${escapeHtml(target)}</code></div>`;

  return `
    <div class="modal-backdrop" role="dialog" aria-modal="true">
      <section class="modal">
        <div class="modal-head">
          <div>
            <h2>${escapeHtml(modal.label)}</h2>
            <div class="muted">先生成并拖放书签，再跳转学校页面运行。</div>
          </div>
          <button id="closeRefreshDialog" class="icon-btn" aria-label="关闭">×</button>
        </div>

        <div class="modal-steps">
          <div><b>1</b><span>选择请求间隔</span></div>
          <div><b>2</b><span>拖动书签按钮到浏览器书签栏</span></div>
          <div><b>3</b><span>确认跳转，到学校页面点击书签</span></div>
        </div>

        <div class="modal-grid">
          <label>刷新间隔
            <div class="delay-control">
              <input id="modalDelayMs" type="number" min="0" step="50" value="${escapeHtml(state.delayMs)}">
              <span class="muted">ms</span>
            </div>
          </label>
          <div class="delay-presets">
            <button class="secondary modal-delay-preset" data-delay="100">100ms</button>
            <button class="secondary modal-delay-preset" data-delay="200">200ms</button>
            <button class="secondary modal-delay-preset" data-delay="300">300ms</button>
            <button class="secondary modal-delay-preset" data-delay="500">500ms</button>
            <button class="secondary modal-delay-preset" data-delay="900">900ms</button>
          </div>
        </div>

        <div class="bookmark-drop">
          <a class="bookmarklet big" href="${escapeHtml(href)}">${escapeHtml(modal.label)}</a>
          <div>
            <b>把左侧蓝色按钮拖到书签栏</b>
            <p>如果浏览器没有显示书签栏，Chrome 可以按 Cmd+Shift+B。旧书签不会自动更新，改了课程或间隔后请重新拖一次。</p>
          </div>
        </div>

        ${localWarning}

        <div class="modal-actions">
          <button id="copyBookmarklet" class="secondary">复制书签地址</button>
          <button id="goSchool" class="primary-action">我已放好书签，跳转学校页面</button>
        </div>
      </section>
    </div>
  `;
}

function renderTable(rows) {
  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>${sortButton("课程", "name")}</th>
            <th>院系/类型</th>
            <th>班级</th>
            <th class="num">${sortButton("总量", "capacity", "num")}</th>
            <th class="num">${sortButton("预选", "selected", "num")}</th>
            <th class="num">${sortButton("余量", "remaining", "num")}</th>
            <th>教师/时间</th>
            <th>是否可选</th>
            <th>${sortButton("更新时间", "updatedAt")}</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(renderRow).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderRow(course) {
  const result = state.results.get(course.kcbh);
  const quota = firstQuota(result);
  const selection = selectability(course);
  const remainingClass = quota?.remaining == null ? "" : quota.remaining > 0 ? "ok" : "bad";
  const statusClass = result?.status === "ok" ? "ok" : result?.status === "error" ? "bad" : result?.status === "missing" ? "warn" : "";
  const updatedAt = result?.updatedAt ? new Date(result.updatedAt).toLocaleString() : "--";
  const selectClass = selection.conflicts ? "conflict" : selection.selected ? "selected" : selection.full ? "full" : selection.hasTime ? "clear" : "unknown";
  const selectButtonClass = selection.conflicts ? "danger" : selection.selected ? "secondary" : "secondary";
  const selectButtonText = selection.selected ? "移出待选" : selection.conflicts ? "冲突，仍加入" : "加入待选";
  const selectDisabled = selection.full && !selection.selected ? "disabled" : "";

  return `
    <tr>
      <td class="course">
        <div class="course-title">${escapeHtml(course.kcmc)}</div>
        <div class="small">${escapeHtml(course.kcbh)}</div>
        <div class="chip-row">
          <span class="chip">${escapeHtml(course.lb || "未分类")}</span>
          <span class="chip">${escapeHtml(course.kcxf)} 学分</span>
          <span class="chip">${escapeHtml(course.kczxs)} 学时</span>
        </div>
      </td>
      <td>${escapeHtml(course.yxmc)}<div class="small">${escapeHtml(course.kclx || course.kkjj || "")}</div></td>
      <td>${escapeHtml(quota?.name || "--")}<div class="small">${escapeHtml(quota?.bjid ? "BJID " + quota.bjid : "")}</div></td>
      <td class="num">${quota?.capacity ?? "--"}</td>
      <td class="num">${quota?.selected ?? "--"}</td>
      <td class="num ${remainingClass}">${quota?.remaining ?? "--"}</td>
      <td>${escapeHtml(quota?.teacher || "")}<div class="small">${escapeHtml(quota?.timePlace || "")}</div><div class="small">${escapeHtml(quota?.campus || "")}</div></td>
      <td><span class="select-status ${selectClass}">${escapeHtml(selection.label)}</span><div class="small">${selection.hasTime ? "已识别时间" : "刷新后可判断时间"}</div></td>
      <td class="${statusClass}">${escapeHtml(updatedAt)}</td>
      <td>
        <div class="row-actions">
          <button class="${selectButtonClass} pending-toggle" data-code="${escapeHtml(course.kcbh)}" ${selectDisabled}>${escapeHtml(selectButtonText)}</button>
          <button class="secondary row-refresh" data-code="${escapeHtml(course.kcbh)}">刷新</button>
        </div>
      </td>
    </tr>
  `;
}

function bindEvents() {
  const set = (id, event, fn) => document.getElementById(id)?.addEventListener(event, fn);

  set("refreshAll", "click", () => openRefreshDialog("all"));
  set("refreshSearch", "click", refreshSearchedCourse);
  set("query", "input", (event) => {
    state.query = event.target.value;
    render();
  });
  set("category", "change", (event) => {
    state.category = event.target.value;
    render();
  });
  set("availability", "change", (event) => {
    state.availability = event.target.value;
    render();
  });
  set("conflictFilter", "change", (event) => {
    state.conflictFilter = event.target.value;
    render();
  });
  set("export", "click", exportCsv);
  set("clearPending", "click", clearPendingCourses);
  set("closeRefreshDialog", "click", closeRefreshDialog);
  set("copyBookmarklet", "click", copyPendingBookmarklet);
  set("goSchool", "click", goSchoolAfterBookmark);
  set("modalDelayMs", "change", (event) => {
    state.delayMs = Math.max(0, Number(event.target.value) || 0);
    saveSettings();
    render();
  });

  document.querySelectorAll(".modal-delay-preset").forEach((button) => {
    button.addEventListener("click", () => {
      state.delayMs = Number(button.dataset.delay) || 300;
      saveSettings();
      render();
    });
  });
  document.querySelectorAll(".sort-btn").forEach((button) => {
    button.addEventListener("click", () => {
      const key = button.dataset.sort;
      if (state.sortKey === key) {
        state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
      } else {
        state.sortKey = key;
        state.sortDir = key === "name" ? "asc" : "desc";
      }
      saveSettings();
      render();
    });
  });
  document.querySelectorAll(".row-refresh").forEach((button) => {
    button.addEventListener("click", () => openRefreshDialog("single", [button.dataset.code]));
  });
  document.querySelectorAll(".pending-toggle").forEach((button) => {
    button.addEventListener("click", () => togglePendingCourse(button.dataset.code));
  });
  document.querySelectorAll("[data-remove-pending]").forEach((button) => {
    button.addEventListener("click", () => removePendingCourse(button.dataset.removePending));
  });
}

function togglePendingCourse(code) {
  if (!code) return;
  if (state.pendingCodes.includes(code)) {
    removePendingCourse(code);
    return;
  }
  state.pendingCodes = uniquePendingCodes([...state.pendingCodes, code]);
  saveSettings();
  render();
}

function removePendingCourse(code) {
  state.pendingCodes = state.pendingCodes.filter((item) => item !== code);
  saveSettings();
  render();
}

function clearPendingCourses() {
  state.pendingCodes = [];
  saveSettings();
  render();
}

function refreshSearchedCourse() {
  const query = state.query.trim();
  if (!query) {
    state.error = "请先输入课程名、编号、院系或教师关键词。";
    state.message = "";
    render();
    return;
  }

  const rows = filteredCourses();
  if (rows.length !== 1) {
    state.error = rows.length
      ? `当前搜索结果有 ${rows.length} 门，请继续输入关键词让结果只剩一门，或点击表格右侧的行内刷新。`
      : "没有匹配课程，请换一个关键词。";
    state.message = "";
    render();
    return;
  }

  openRefreshDialog("single", [rows[0].kcbh]);
}

async function loadCourses() {
  const data = await api("/api/courses");
  state.courses = data.courses || [];
  state.categories = data.categories || [];
  state.pendingCodes = uniquePendingCodes(state.pendingCodes);
  saveSettings();
}

async function loadCache() {
  const data = await api("/api/cache?_=" + Date.now());
  state.cacheUpdatedAt = data.cache?.updatedAt || "";
  state.storage = data.storage || null;
  state.results = new Map();
  const results = data.cache?.results || {};
  for (const [code, result] of Object.entries(results)) {
    state.results.set(code, result);
  }
}

function exportCsv() {
  const rows = [["课程编号", "课程名称", "类别", "院系", "班级ID", "班级名称", "容量", "预选人数", "余量", "教师", "时间地点", "待选状态", "状态", "更新时间"]];
  for (const course of state.courses) {
    const result = state.results.get(course.kcbh);
    const selection = selectability(course);
    if (result?.rows?.length) {
      for (const quota of result.rows) {
        rows.push([course.kcbh, course.kcmc, course.lb, course.yxmc, quota.bjid, quota.name, quota.capacity ?? "", quota.selected ?? "", quota.remaining ?? "", quota.teacher, quota.timePlace, selection.label, statusText(result), result.updatedAt || ""]);
      }
    } else {
      rows.push([course.kcbh, course.kcmc, course.lb, course.yxmc, "", "", "", "", "", "", "", selection.label, statusText(result), result?.updatedAt || ""]);
    }
  }
  const csv = rows.map((row) => row.map((value) => `"${String(value == null ? "" : value).replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "学术交流月余量-" + new Date().toISOString().replace(/[:.]/g, "-") + ".csv";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 500);
}

async function boot() {
  state.error = "";
  try {
    await loadCourses();
    await loadCache();
    render();
    state.message = state.cacheUpdatedAt
      ? "当前展示的是上一次刷新快照。要更新数据，请点击刷新入口并按弹窗说明拖放书签。"
      : "暂无历史快照。请点击刷新入口，按弹窗说明拖放书签后在学校页面运行。";
    render();
  } catch (error) {
    state.error = error.message;
    render();
  }
}

boot();
