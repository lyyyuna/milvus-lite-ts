# milvus-lite (Node.js)

Node.js/TypeScript wrapper for [milvus-lite](https://github.com/milvus-io/milvus-lite) — an embedded vector database.

Start a milvus-lite server from Node.js with zero external dependencies. The pre-built binary is automatically downloaded from PyPI on first use and cached locally.

## Install

```bash
npm install milvus-lite @zilliz/milvus2-sdk-node
```

## Usage

```typescript
import { start } from "milvus-lite";
import { MilvusClient, DataType } from "@zilliz/milvus2-sdk-node";

// Start milvus-lite (downloads binary on first run)
const server = await start("./milvus.db");

// Connect with the official Node.js SDK
const client = new MilvusClient({ address: server.addr });

// Use as normal Milvus
await client.createCollection({
  collection_name: "demo",
  fields: [
    { name: "id", data_type: DataType.Int64, is_primary_key: true, autoID: true },
    { name: "vector", data_type: DataType.FloatVector, dim: 128 },
  ],
});

// Don't forget to stop when done
await server.stop();
```

## How it works

1. On first `start()`, downloads the milvus-lite wheel from PyPI (respects `pip.conf` mirror settings for users in China)
2. Extracts the `milvus` binary + shared libraries to `~/.cache/milvus-lite/{version}/{os}-{arch}/`
3. Starts the binary as a subprocess listening on a random localhost port
4. Returns the gRPC address for use with [@zilliz/milvus2-sdk-node](https://github.com/milvus-io/milvus-sdk-node)

## API

### `start(dbFile, options?)`

Starts a milvus-lite server.

- `dbFile` — Path to the local database file (e.g., `"./milvus.db"`)
- `options.address` — gRPC address (default: random port on localhost)
- `options.logLevel` — `"INFO"` or `"ERROR"` (default: `"ERROR"`)

Returns `{ addr: string, stop: () => Promise<void> }`

## Supported platforms

| OS | Arch | Status |
|----|------|--------|
| macOS | arm64 (Apple Silicon) | ✅ |
| macOS | amd64 (Intel) | ✅ |
| Linux | amd64 | ✅ |
| Linux | arm64 | ✅ |

## API compatibility

All milvus-lite supported APIs work with the official Node.js SDK:

- **Collection**: Create, Drop, Has, Describe, List, GetStatistics
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
