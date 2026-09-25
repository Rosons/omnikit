import { describe, expect, it } from "vitest";
import { DEFAULT_RULE, buildNewName, buildPlans, nameError } from "./rename";

const MTIME = 1789000000; // 2026-09-09 附近
const base = { ...DEFAULT_RULE };

describe("buildNewName 基础变换", () => {
  it("字面量查找替换", () => {
    const r = { ...base, find: "[www.example.com]", replace: "" };
    expect(buildNewName("[www.example.com]教程01.pdf", 0, MTIME, r)).toBe("教程01.pdf");
  });

  it("正则替换去数字前缀", () => {
    const r = { ...base, find: "^\\d+-", replace: "", useRegex: true };
    expect(buildNewName("12-报告.docx", 0, MTIME, r)).toBe("报告.docx");
  });

  it("正则非法时不动名字", () => {
    const r = { ...base, find: "([", replace: "x", useRegex: true };
    expect(buildNewName("a.txt", 0, MTIME, r)).toBe("a.txt");
  });

  it("前后缀加在扩展名前", () => {
    const r = { ...base, prefix: "新-", suffix: "-终" };
    expect(buildNewName("照片.jpg", 0, MTIME, r)).toBe("新-照片-终.jpg");
  });

  it("无扩展名的文件也正常处理", () => {
    const r = { ...base, suffix: "-v2" };
    expect(buildNewName("Makefile", 0, MTIME, r)).toBe("Makefile-v2");
  });
});

describe("buildNewName 序号与日期", () => {
  it("序号补零从起始值递增", () => {
    const r = { ...base, seqEnabled: true, seqStart: 5, seqPad: 3, seqSep: "-" };
    expect(buildNewName("IMG.jpg", 0, MTIME, r)).toBe("IMG-005.jpg");
    expect(buildNewName("IMG.jpg", 2, MTIME, r)).toBe("IMG-007.jpg");
  });

  it("日期注入取修改时间 yyyyMMdd", () => {
    const r = { ...base, dateEnabled: true, dateSep: "-" };
    const out = buildNewName("log.txt", 0, MTIME, r);
    expect(out).toMatch(/^log-\d{8}\.txt$/);
  });

  it("日期与序号叠加，日期在前", () => {
    const r = { ...base, dateEnabled: true, dateSep: "-", seqEnabled: true, seqStart: 1, seqPad: 2 };
    const out = buildNewName("a.png", 0, MTIME, r);
    expect(out).toMatch(/^a-\d{8}-01\.png$/);
  });

  it("替换后重新识别扩展名", () => {
    const r = { ...base, find: "txt", replace: "md" };
    expect(buildNewName("readme.txt", 0, MTIME, r)).toBe("readme.md");
  });
});

describe("buildPlans 冲突检测", () => {
  it("序号导致批内重名时全部标红", () => {
    const r = { ...base, find: ".*", replace: "同名", useRegex: true };
    const plans = buildPlans(
      [{ name: "a.txt", mtimeSec: MTIME }, { name: "b.txt", mtimeSec: MTIME }],
      r,
    );
    expect(plans.every((p) => p.err === "批内重名")).toBe(true);
  });

  it("正常计划无错误且一一对应", () => {
    const r = { ...base, seqEnabled: true, seqStart: 1, seqPad: 3 };
    const plans = buildPlans(
      [{ name: "a.jpg", mtimeSec: MTIME }, { name: "b.jpg", mtimeSec: MTIME }],
      r,
    );
    expect(plans.map((p) => p.to)).toEqual(["a-001.jpg", "b-002.jpg"]);
    expect(plans.every((p) => p.err === "")).toBe(true);
  });
});

describe("nameError 非法名", () => {
  it("拦非法字符与保留名", () => {
    expect(nameError("a/b")).not.toBe("");
    expect(nameError("a:b")).not.toBe("");
    expect(nameError("con.txt")).not.toBe("");
    expect(nameError("正常名字.txt")).toBe("");
  });
});
