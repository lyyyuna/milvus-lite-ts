# milvus-lite (Node.js)

Node.js/TypeScript wrapper for [milvus-lite](https://github.com/milvus-io/milvus-lite) — an embedded vector database.

The pre-built milvus binary is bundled in platform-specific npm packages. `npm install` automatically picks the right one for your platform — no runtime downloads needed.

## Install

```bash
npm install @lyyyuna/milvus-lite @zilliz/milvus2-sdk-node
```

## Usage

```typescript
import { start } from "@lyyyuna/milvus-lite";
import { MilvusClient, DataType } from "@zilliz/milvus2-sdk-node";

const server = await start("./milvus.db");

const client = new MilvusClient({ address: server.addr });

await client.createCollection({
  collection_name: "demo",
  fields: [
    { name: "id", data_type: DataType.Int64, is_primary_key: true, autoID: true },
    { name: "vector", data_type: DataType.FloatVector, dim: 128 },
  ],
});

await server.stop();
```

## How it works

```
@lyyyuna/milvus-lite                     ← main package (pure JS)
├── optionalDependencies:
│   ├── @lyyyuna/milvus-lite-darwin-arm64    ← macOS Apple Silicon binary
│   ├── @lyyyuna/milvus-lite-darwin-x64      ← macOS Intel binary
│   ├── @lyyyuna/milvus-lite-linux-x64       ← Linux amd64 binary
│   └── @lyyyuna/milvus-lite-linux-arm64     ← Linux arm64 binary
```

npm automatically installs only the package matching your platform. At runtime, `start()` requires the platform package to get the binary path, then spawns it as a subprocess.

## API

### `start(dbFile, options?)`

Starts a milvus-lite server.

- `dbFile` — Path to the local database file (e.g., `"./milvus.db"`)
- `options.address` — gRPC address (default: random port on localhost)
- `options.logLevel` — `"INFO"` or `"ERROR"` (default: `"ERROR"`)

Returns `{ addr: string, stop: () => Promise<void> }`

## Supported platforms

| OS | Arch | npm package |
|----|------|-------------|
| macOS | arm64 (Apple Silicon) | `@lyyyuna/milvus-lite-darwin-arm64` |
| macOS | amd64 (Intel) | `@lyyyuna/milvus-lite-darwin-x64` |
| Linux | amd64 | `@lyyyuna/milvus-lite-linux-x64` |
| Linux | arm64 | `@lyyyuna/milvus-lite-linux-arm64` |

## API compatibility

All milvus-lite supported APIs work with the official Node.js SDK:

- **Collection**: Create, Drop, Has, List, GetStatistics
- **Index**: Create (FLAT, IVF_FLAT), Describe, Drop
- **Data**: Insert, Upsert, Delete
- **Search**: Search (with filters), Query
- **Load**: Load, Release, GetLoadState

### Known issues

**`describeCollection` may throw** — The Node.js SDK v2.6+ reformats the response in a way that's incompatible with milvus-lite's minimal response. Use `listCollections` for collection discovery.

**Unsupported features** (same as milvus-lite limitations):
- Partitions
- RBAC (users/roles)
- Aliases

## License

Apache 2.0
