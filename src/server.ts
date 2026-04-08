import { ChildProcess, spawn } from "child_process";
import * as net from "net";
import * as path from "path";
import * as fs from "fs";
import { ensureBinary, MILVUS_LITE_VERSION } from "./download";

export interface MilvusLiteServer {
  /** The gRPC address to connect to (e.g., "localhost:19530") */
  addr: string;
  /** Stop the milvus-lite server */
  stop(): Promise<void>;
}

export interface StartOptions {
  /** gRPC address to listen on. If not set, a random port is used. */
  address?: string;
  /** Log level: "INFO" or "ERROR". Default: "ERROR" */
  logLevel?: "INFO" | "ERROR";
}

/**
 * Start a milvus-lite server.
 *
 * Downloads the binary on first use from PyPI (respects pip.conf mirrors).
 * Subsequent calls use the cached binary at ~/.cache/milvus-lite/.
 *
 * @param dbFile Path to the local database file (e.g., "./milvus.db")
 * @param options Optional configuration
 * @returns A running server with addr and stop()
 */
export async function start(
  dbFile: string,
  options?: StartOptions
): Promise<MilvusLiteServer> {
  const lib = await ensureBinary(MILVUS_LITE_VERSION);

  const addr = options?.address ?? `localhost:${await freePort()}`;
  const logLevel = options?.logLevel ?? "ERROR";

  const absDB = path.resolve(dbFile);
  const dbDir = path.dirname(absDB);
  fs.mkdirSync(dbDir, { recursive: true });

  const bin = path.join(lib, "milvus");
  const env: Record<string, string> = { ...process.env } as Record<
    string,
    string
  >;

  if (process.platform === "darwin") {
    env.DYLD_LIBRARY_PATH = `${lib}:${env.DYLD_LIBRARY_PATH ?? ""}`;
  } else if (process.platform === "linux") {
    env.LD_LIBRARY_PATH = `${lib}:${env.LD_LIBRARY_PATH ?? ""}`;
  }

  const child = spawn(bin, [absDB, addr, logLevel], {
    cwd: dbDir,
    env,
    stdio: "pipe",
  });

  // Check if process exits immediately
  const earlyExit = new Promise<never>((_, reject) => {
    child.on("exit", (code) => {
      reject(new Error(`milvus exited immediately with code ${code}`));
    });
  });

  const ready = waitForPort(addr, 10000);

  try {
    await Promise.race([ready, earlyExit]);
  } catch (err) {
    child.kill("SIGKILL");
    throw err;
  }

  // Remove the early exit listener now that we're running
  child.removeAllListeners("exit");

  return {
    addr,
    stop: () => stopProcess(child),
  };
}

function stopProcess(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (child.killed || child.exitCode !== null) {
      resolve();
      return;
    }

    child.on("exit", () => resolve());
    child.kill("SIGKILL");

    // Timeout safety
    setTimeout(() => resolve(), 3000);
  });
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "localhost", () => {
      const address = srv.address();
      if (address && typeof address === "object") {
        const port = address.port;
        srv.close(() => resolve(port));
      } else {
        srv.close(() => reject(new Error("Failed to get port")));
      }
    });
    srv.on("error", reject);
  });
}

function waitForPort(addr: string, timeoutMs: number): Promise<void> {
  const [host, portStr] = addr.split(":");
  const port = parseInt(portStr, 10);

  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;

    function attempt() {
      if (Date.now() > deadline) {
        reject(new Error(`Timeout waiting for ${addr}`));
        return;
      }

      const socket = new net.Socket();
      socket.setTimeout(200);

      socket.on("connect", () => {
        socket.destroy();
        resolve();
      });

      socket.on("error", () => {
        socket.destroy();
        setTimeout(attempt, 100);
      });

      socket.on("timeout", () => {
        socket.destroy();
        setTimeout(attempt, 100);
      });

      socket.connect(port, host);
    }

    attempt();
  });
}
