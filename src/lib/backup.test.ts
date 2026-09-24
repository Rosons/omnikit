import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyBackup, collectBackup } from "./backup";

// node 测试环境没有 localStorage,用 Map 实现最小桩
const store = new Map<string, string>();
globalThis.localStorage = {
  get length() {
    return store.size;
  },
  key: (i: number) => Array.from(store.keys())[i] ?? null,
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
};

describe("设置备份 collectBackup", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("omnikit.theme", "dark");
    localStorage.setItem("omnikit.http.record", "off");
    localStorage.setItem("other.key", "不该被收集");
  });

  it("只收集 omnikit. 前缀的键", () => {
    const b = collectBackup();
    expect(Object.keys(b.data).sort()).toEqual(["omnikit.http.record", "omnikit.theme"]);
    expect(b.app).toBe("omnikit");
    expect(b.schema).toBe(1);
  });

  it("空存储导出空 data", () => {
    localStorage.clear();
    expect(collectBackup().data).toEqual({});
  });
});

describe("设置备份 applyBackup", () => {
  beforeEach(() => localStorage.clear());

  it("恢复备份里的键并返回数量", () => {
    const n = applyBackup(
      JSON.stringify({
        app: "omnikit",
        schema: 1,
        exportedAt: "2026-09-24T00:00:00.000Z",
        data: { "omnikit.theme": "light", "外部键": "跳过" },
      }),
    );
    expect(n).toBe(1);
    expect(localStorage.getItem("omnikit.theme")).toBe("light");
  });

  it("导入会覆盖同名键但不删除其他键", () => {
    localStorage.setItem("omnikit.theme", "dark");
    localStorage.setItem("omnikit.favs", '["clip"]');
    applyBackup(
      JSON.stringify({
        app: "omnikit",
        schema: 1,
        exportedAt: "",
        data: { "omnikit.theme": "light" },
      }),
    );
    expect(localStorage.getItem("omnikit.theme")).toBe("light");
    expect(localStorage.getItem("omnikit.favs")).toBe('["clip"]');
  });

  it("坏 JSON 抛错", () => {
    expect(() => applyBackup("{oops")).toThrow("JSON");
  });

  it("非 OmniKit 备份抛错", () => {
    expect(() => applyBackup(JSON.stringify({ app: "别的", schema: 1, data: {} }))).toThrow(
      "不是 OmniKit 的备份文件",
    );
  });

  it("备份为空抛错", () => {
    expect(() =>
      applyBackup(JSON.stringify({ app: "omnikit", schema: 1, exportedAt: "", data: {} })),
    ).toThrow("没有可用的");
  });
});

afterEach(() => localStorage.clear());
