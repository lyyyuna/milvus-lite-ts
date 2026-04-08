import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as https from "https";
import * as http from "http";
import * as crypto from "crypto";
import { createUnzip } from "zlib";

export const MILVUS_LITE_VERSION = "2.5.1";

const DEFAULT_PYPI_SIMPLE_URL = "https://pypi.org/simple/milvus-lite/";

interface PlatformInfo {
  wheelPlatform: string;
  cacheKey: string;
}

function getPlatformInfo(): PlatformInfo {
  const platform = process.platform;
  const arch = process.arch;

  const key = `${platform}/${arch}`;
  const map: Record<string, PlatformInfo> = {
    "darwin/arm64": {
      wheelPlatform: "macosx_11_0_arm64",
      cacheKey: "darwin-arm64",
    },
    "darwin/x64": {
      wheelPlatform: "macosx_10_9_x86_64",
      cacheKey: "darwin-x64",
    },
    "linux/x64": {
      wheelPlatform: "manylinux2014_x86_64",
      cacheKey: "linux-x64",
    },
    "linux/arm64": {
      wheelPlatform: "manylinux2014_aarch64",
      cacheKey: "linux-arm64",
    },
  };

  const info = map[key];
  if (!info) {
    throw new Error(`Unsupported platform: ${key}`);
  }
  return info;
}

function wheelFileName(version: string, wheelPlatform: string): string {
  return `milvus_lite-${version}-py3-none-${wheelPlatform}.whl`;
}

function cacheDir(version: string, cacheKey: string): string {
  return path.join(os.homedir(), ".cache", "milvus-lite", version, cacheKey);
}

export function libDir(version: string): string | null {
  const info = getPlatformInfo();
  const dir = path.join(cacheDir(version, info.cacheKey), "lib");
  const bin = path.join(dir, "milvus");
  if (fs.existsSync(bin)) {
    return dir;
  }
  return null;
}

export async function ensureBinary(version: string): Promise<string> {
  const existing = libDir(version);
  if (existing) {
    return existing;
  }

  const info = getPlatformInfo();
  const dir = cacheDir(version, info.cacheKey);
  const whlName = wheelFileName(version, info.wheelPlatform);
  const baseURL = pypiSimpleURL();

  const { url: downloadURL, sha256 } = await resolveWheelURL(
    baseURL,
    whlName
  );

  fs.mkdirSync(dir, { recursive: true });
  const whlPath = path.join(dir, whlName);

  await downloadFile(downloadURL, whlPath, sha256);

  const lib = path.join(dir, "lib");
  await extractLib(whlPath, lib);

  // Make milvus binary executable
  fs.chmodSync(path.join(lib, "milvus"), 0o755);

  // Clean up wheel file
  fs.unlinkSync(whlPath);

  return lib;
}

function pypiSimpleURL(): string {
  for (const configPath of pipConfigPaths()) {
    try {
      const content = fs.readFileSync(configPath, "utf-8");
      const url = parsePipIndexURL(content);
      if (url) {
        return url.replace(/\/+$/, "") + "/milvus-lite/";
      }
    } catch {
      // File doesn't exist or can't be read
    }
  }
  return DEFAULT_PYPI_SIMPLE_URL;
}

function pipConfigPaths(): string[] {
  const home = os.homedir();
  const paths = [
    path.join(home, ".pip", "pip.conf"),
    path.join(home, ".config", "pip", "pip.conf"),
  ];
  if (process.platform === "win32") {
    const appdata = process.env.APPDATA;
    if (appdata) {
      paths.push(path.join(appdata, "pip", "pip.ini"));
    }
  }
  return paths;
}

export function parsePipIndexURL(content: string): string | null {
  const match = content.match(/^\s*index-url\s*=\s*(.+)$/m);
  return match ? match[1].trim() : null;
}

async function resolveWheelURL(
  simpleURL: string,
  targetFilename: string
): Promise<{ url: string; sha256: string }> {
  const body = await fetchText(simpleURL);

  const escaped = targetFilename.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`<a\\s+href="([^"]+)"[^>]*>\\s*${escaped}\\s*</a>`);
  const match = body.match(re);
  if (!match) {
    throw new Error(`Wheel ${targetFilename} not found in index`);
  }

  let href = match[1];
  let sha256 = "";

  // Extract sha256 from fragment
  const hashIdx = href.indexOf("#sha256=");
  if (hashIdx !== -1) {
    sha256 = href.slice(hashIdx + 8);
    href = href.slice(0, hashIdx);
  }

  // Resolve relative URL
  if (href.startsWith("../../") || !href.startsWith("http")) {
    let base = simpleURL.replace(/\/+$/, "");
    while (href.startsWith("../")) {
      href = href.slice(3);
      base = base.slice(0, base.lastIndexOf("/"));
    }
    href = base + "/" + href;
  }

  return { url: href, sha256 };
}

function fetchText(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https") ? https : http;
    client.get(url, { headers: { Accept: "text/html" } }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        fetchText(res.headers.location).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }
      const chunks: Buffer[] = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
      res.on("error", reject);
    }).on("error", reject);
  });
}

function downloadFile(
  url: string,
  dest: string,
  expectedSHA256: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https") ? https : http;
    client.get(url, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        downloadFile(res.headers.location, dest, expectedSHA256).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }

      const file = fs.createWriteStream(dest);
      const hasher = crypto.createHash("sha256");

      res.on("data", (chunk) => {
        file.write(chunk);
        hasher.update(chunk);
      });

      res.on("end", () => {
        file.end(() => {
          if (expectedSHA256) {
            const actual = hasher.digest("hex");
            if (actual !== expectedSHA256) {
              fs.unlinkSync(dest);
              reject(
                new Error(
                  `SHA256 mismatch: expected ${expectedSHA256}, got ${actual}`
                )
              );
              return;
            }
          }
          resolve();
        });
      });

      res.on("error", (err) => {
        file.close();
        reject(err);
      });
    }).on("error", reject);
  });
}

async function extractLib(whlPath: string, destDir: string): Promise<void> {
  // Wheel files are zip files. Use yauzl-style manual parsing
  // since we only need to extract milvus_lite/lib/*
  const { execSync } = await import("child_process");

  fs.mkdirSync(destDir, { recursive: true });

  // Use system unzip command (available on all target platforms)
  execSync(`unzip -o -q "${whlPath}" "milvus_lite/lib/*" -d "${destDir}_tmp"`, {
    stdio: "pipe",
  });

  // Move from nested milvus_lite/lib/ to destDir
  const srcLib = path.join(`${destDir}_tmp`, "milvus_lite", "lib");
  const entries = fs.readdirSync(srcLib);
  for (const entry of entries) {
    fs.renameSync(path.join(srcLib, entry), path.join(destDir, entry));
  }

  // Clean up temp dir
  fs.rmSync(`${destDir}_tmp`, { recursive: true, force: true });
}
