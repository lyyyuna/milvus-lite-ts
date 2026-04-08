import { describe, it, expect } from "vitest";
import { parsePipIndexURL } from "../src/download";

describe("parsePipIndexURL", () => {
  it("parses tuna mirror", () => {
    const content = `[global]\nindex-url = https://pypi.tuna.tsinghua.edu.cn/simple\n`;
    expect(parsePipIndexURL(content)).toBe(
      "https://pypi.tuna.tsinghua.edu.cn/simple"
    );
  });

  it("handles extra spaces", () => {
    const content = `[global]\n  index-url =   https://mirrors.aliyun.com/pypi/simple/  \n`;
    expect(parsePipIndexURL(content)).toBe(
      "https://mirrors.aliyun.com/pypi/simple/"
    );
  });

  it("returns null when no index-url", () => {
    expect(parsePipIndexURL("[global]\ntimeout = 60\n")).toBeNull();
  });

  it("returns null for empty content", () => {
    expect(parsePipIndexURL("")).toBeNull();
  });
});
