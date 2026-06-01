import fs from "node:fs";

const dataPath = new URL("../data/courses.json", import.meta.url);
const source = JSON.parse(fs.readFileSync(dataPath, "utf8"));

export const courses = source.aaData.map((course, index) => ({
  rownum: course.ROWNUM_ ?? index + 1,
  kcbh: String(course.KCBH ?? "").trim(),
  kcmc: String(course.KCMC ?? "").trim(),
  yxmc: String(course.YXMC ?? "").trim(),
  lb: String(course.LB ?? "").trim(),
  kclx: course.KCLX == null ? "" : String(course.KCLX).trim(),
  kkjj: course.KKJJ == null ? "" : String(course.KKJJ).trim(),
  kcxf: course.KCXF ?? "",
  kczxs: course.KCZXS ?? "",
  ksfs: course.KSFS == null ? "" : String(course.KSFS).trim(),
  kclbm: course.KCLBM == null ? "" : String(course.KCLBM).trim(),
  sfbfa: course.SFBFA == null ? "2" : String(course.SFBFA).trim(),
}));

export const courseById = new Map(courses.map((course) => [course.kcbh, course]));

export function getCourse(kcbh) {
  return courseById.get(String(kcbh || "").trim());
}

export function normalizeCourseCodes(codes) {
  const items = Array.isArray(codes) ? codes : String(codes || "").split(/[\s,，;；]+/);
  return items.map((code) => String(code || "").trim()).filter(Boolean);
}

export function getCoursesFromCodes(codes) {
  return normalizeCourseCodes(codes).map((code) => {
    const course = getCourse(code);
    if (!course) {
      const error = new Error(`未知课程编号：${code}`);
      error.status = 400;
      throw error;
    }
    return course;
  });
}

export function pairCourses(list = courses) {
  const pairs = [];
  for (let index = 0; index < list.length; index += 2) {
    pairs.push(list.slice(index, index + 2));
  }
  return pairs;
}

export function defaultRestoreCodes() {
  return normalizeCourseCodes(process.env.RESTORE_COURSES || "");
}
