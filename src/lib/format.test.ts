import { describe, expect, it } from "vitest";
import { baseName, fmtBytes } from "./format";

describe("baseName", () => {
  it("兼容两种分隔符", () => {
    expect(baseName("C:\\a\\b\\c.txt")).toBe("c.txt");
    expect(baseName("/usr/local/bin/node")).toBe("node");
    expect(baseName("plain.txt")).toBe("plain.txt");
  });
});

describe("fmtBytes", () => {
  it("字节与进位", () => {
    expect(fmtBytes(512)).toBe("512 B");
    expect(fmtBytes(1024)).toBe("1.0 KB");
    expect(fmtBytes(1536 * 1024)).toBe("1.5 MB");
    expect(fmtBytes(3 * 1024 * 1024 * 1024)).toBe("3.0 GB");
  });
});
