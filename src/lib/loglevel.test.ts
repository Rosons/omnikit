import { describe, expect, it } from "vitest";
import { levelOf } from "./loglevel";

describe("levelOf", () => {
  it("常见级别写法", () => {
    expect(levelOf("2026-09-20 ERROR 连接失败")).toBe("err");
    expect(levelOf("[FATAL]boom")).toBe("err");
    expect(levelOf("level=warning msg=x")).toBe("warn");
    expect(levelOf("[WARN]xx")).toBe("warn");
    expect(levelOf("2026-09-20 10:00 DEBUG xx")).toBe("dbg");
    expect(levelOf("[trace] x")).toBe("dbg");
    expect(levelOf("INFO ok")).toBe("info");
  });

  it("普通行归为 info", () => {
    expect(levelOf("hello world")).toBe("info");
    expect(levelOf("")).toBe("info");
  });

  it("大小写不敏感，但普通单词不误判", () => {
    expect(levelOf("error happened")).toBe("err");
    // warning 是整词匹配,warningly 里的 warn 不算
    expect(levelOf("warningly")).toBe("info");
  });
});
