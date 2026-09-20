import { describe, expect, it } from "vitest";
import { parseCurl, tokenize } from "./curl";

describe("tokenize", () => {
  it("按空白切分并剥引号", () => {
    expect(tokenize("curl -X POST 'https://a.com'")).toEqual(["curl", "-X", "POST", "https://a.com"]);
  });

  it("行尾续行符合并为一行", () => {
    expect(tokenize("curl \\\n  -d k=v \\\r\n  https://a.com")).toEqual(["curl", "-d", "k=v", "https://a.com"]);
  });

  it("双引号内保留空格并处理转义", () => {
    expect(tokenize('-d "{\\"a\\": \\"1 2\\"}"')).toEqual(["-d", '{"a": "1 2"}']);
  });

  it("单引号内反斜杠不转义", () => {
    expect(tokenize("-d 'a\\nb'")).toEqual(["-d", "a\\nb"]);
  });
});

describe("parseCurl", () => {
  it("裸 URL 默认 GET", () => {
    const r = parseCurl("curl https://api.example.com/users");
    expect(r).toMatchObject({ method: "GET", url: "https://api.example.com/users", body: "" });
  });

  it("POST + 头 + JSON 体", () => {
    const r = parseCurl(
      `curl -X POST -H 'Content-Type: application/json' -d '{"name":"张三"}' https://a.com/users`,
    );
    expect(r.method).toBe("POST");
    expect(r.body).toBe('{"name":"张三"}');
    expect(r.headers[0]).toEqual({ k: "Content-Type", v: "application/json" });
  });

  it("多个 -d 用 & 拼接，主机：端口形式识别为 URL", () => {
    const r = parseCurl('curl -d "a=1" -d "b=2" example.com:8080/x');
    expect(r).toMatchObject({ method: "POST", url: "example.com:8080/x", body: "a=1&b=2" });
  });

  it("续行符拆开的多行命令", () => {
    const r = parseCurl("curl -X PUT https://a.com \\\n  -H 'X-Token: t1' \\\n  -d 'k=v'");
    expect(r.method).toBe("PUT");
    expect(r.body).toBe("k=v");
    expect(r.headers[0]).toEqual({ k: "X-Token", v: "t1" });
  });

  it("-u 生成 Basic 认证头", () => {
    const r = parseCurl("curl -u admin:secret https://a.com");
    expect(r.headers[0]?.k).toBe("Authorization");
    expect(r.headers[0]?.v).toBe(`Basic ${btoa("admin:secret")}`);
  });

  it("-G 把 -d 数据拼到查询串", () => {
    const r = parseCurl("curl -G -d q=张 -d page=2 https://a.com/search");
    expect(r.url).toBe("https://a.com/search?q=张&page=2");
    expect(r.method).toBe("GET");
  });

  it("附加值写法 -XPOST 与 -H\"…\"", () => {
    const r = parseCurl('curl -XPOST https://a.com -H"X-A: 1"');
    expect(r.method).toBe("POST");
    expect(r.headers[0]).toEqual({ k: "X-A", v: "1" });
  });

  it("--flag=value 形式", () => {
    const r = parseCurl("curl --request=DELETE --url=https://a.com/1");
    expect(r).toMatchObject({ method: "DELETE", url: "https://a.com/1" });
  });

  it("-I 视为 HEAD", () => {
    expect(parseCurl("curl -I https://a.com").method).toBe("HEAD");
  });

  it("--json 快捷形式", () => {
    const r = parseCurl(`curl --json '{"a":1}' https://a.com`);
    expect(r.method).toBe("POST");
    expect(r.body).toBe('{"a":1}');
    expect(r.headers.some((h) => h.k === "Content-Type" && h.v === "application/json")).toBe(true);
  });

  it("未知旗标跳过并记提醒", () => {
    const r = parseCurl("curl -sL -k --compressed --whatever https://a.com");
    expect(r.url).toBe("https://a.com");
    expect(r.warnings.some((w) => w.includes("--whatever"))).toBe(true);
  });

  it("@文件请求体给出提醒", () => {
    const r = parseCurl("curl -d @body.json https://a.com");
    expect(r.body).toBe("");
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it("没有 URL 时抛错", () => {
    expect(() => parseCurl("-X POST")).toThrow();
  });
});
