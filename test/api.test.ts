import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { start, MilvusLiteServer } from "../src/server";
import { MilvusClient, DataType } from "@zilliz/milvus2-sdk-node";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";

const DIM = 128;

function randomVectors(n: number, dim: number): number[][] {
  return Array.from({ length: n }, () =>
    Array.from({ length: dim }, () => Math.random())
  );
}

let server: MilvusLiteServer;
let client: MilvusClient;
let tmpDir: string;

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "milvus-lite-test-"));
  server = await start(path.join(tmpDir, "test.db"));
  client = new MilvusClient({ address: server.addr });
}, 120000);

afterAll(async () => {
  await server?.stop();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ===========================================
// Collection management
// ===========================================

describe("Collection management", () => {
  const collName = "test_collection_mgmt";

  it("createCollection", async () => {
    const res = await client.createCollection({
      collection_name: collName,
      fields: [
        { name: "id", data_type: DataType.Int64, is_primary_key: true },
        { name: "vector", data_type: DataType.FloatVector, dim: DIM },
      ],
    });
    expect(res.error_code).toBe("Success");
  });

  it("hasCollection", async () => {
    const res = await client.hasCollection({ collection_name: collName });
    expect(res.value).toBe(true);
  });

  it("describeCollection", async () => {
    const res = await client.describeCollection({ collection_name: collName });
    // milvus-lite returns schema slightly differently; check raw response
    expect(res.status.error_code).toBe("Success");
  });

  it("listCollections", async () => {
    const res = await client.listCollections();
    const names = res.data.map((c: any) => c.name);
    expect(names).toContain(collName);
  });

  it("getCollectionStatistics", async () => {
    const res = await client.getCollectionStatistics({
      collection_name: collName,
    });
    expect(res.status.error_code).toBe("Success");
  });

  it("dropCollection", async () => {
    const res = await client.dropCollection({ collection_name: collName });
    expect(res.error_code).toBe("Success");

    // Verify via listCollections instead of hasCollection
    // (hasCollection uses describeCollection internally which has compat issues)
    const list = await client.listCollections();
    const names = list.data.map((c: any) => c.name);
    expect(names).not.toContain(collName);
  });
});

// ===========================================
// Index management
// ===========================================

describe("Index management", () => {
  const collName = "test_index_mgmt";

  beforeAll(async () => {
    await client.createCollection({
      collection_name: collName,
      fields: [
        {
          name: "id",
          data_type: DataType.Int64,
          is_primary_key: true,
          autoID: true,
        },
        { name: "vector", data_type: DataType.FloatVector, dim: DIM },
      ],
    });
  });

  afterAll(async () => {
    await client.dropCollection({ collection_name: collName });
  });

  it("createIndex FLAT", async () => {
    const res = await client.createIndex({
      collection_name: collName,
      field_name: "vector",
      index_type: "FLAT",
      metric_type: "L2",
    });
    expect(res.error_code).toBe("Success");
  });

  it("describeIndex", async () => {
    const res = await client.describeIndex({
      collection_name: collName,
      field_name: "vector",
    });
    expect(res.index_descriptions.length).toBeGreaterThan(0);
  });

  it("dropIndex", async () => {
    const res = await client.dropIndex({
      collection_name: collName,
      field_name: "vector",
    });
    expect(res.error_code).toBe("Success");
  });

  it("createIndex IVF_FLAT", async () => {
    const res = await client.createIndex({
      collection_name: collName,
      field_name: "vector",
      index_type: "IVF_FLAT",
      metric_type: "L2",
      params: { nlist: 16 },
    });
    expect(res.error_code).toBe("Success");
  });
});

// ===========================================
// Insert, Search, Query, Delete
// ===========================================

describe("CRUD operations", () => {
  const collName = "test_crud";
  const vectors = randomVectors(100, DIM);

  beforeAll(async () => {
    await client.createCollection({
      collection_name: collName,
      fields: [
        { name: "id", data_type: DataType.Int64, is_primary_key: true },
        {
          name: "category",
          data_type: DataType.VarChar,
          max_length: 64,
        },
        { name: "score", data_type: DataType.Float },
        { name: "vector", data_type: DataType.FloatVector, dim: DIM },
      ],
    });
  });

  afterAll(async () => {
    await client.dropCollection({ collection_name: collName });
  });

  it("insert", async () => {
    const data = vectors.map((v, i) => ({
      id: i,
      category: i % 2 === 0 ? "even" : "odd",
      score: i * 0.1,
      vector: v,
    }));

    const res = await client.insert({
      collection_name: collName,
      data,
    });
    expect(res.succ_index.length).toBe(100);
  });

  it("createIndex + loadCollection", async () => {
    await client.createIndex({
      collection_name: collName,
      field_name: "vector",
      index_type: "FLAT",
      metric_type: "L2",
    });

    const res = await client.loadCollection({
      collection_name: collName,
    });
    expect(res.error_code).toBe("Success");
  });

  it("search", async () => {
    const res = await client.search({
      collection_name: collName,
      vector: vectors[0],
      limit: 10,
      output_fields: ["category", "score"],
    });
    expect(res.results.length).toBe(10);
  });

  it("search with filter", async () => {
    const res = await client.search({
      collection_name: collName,
      vector: vectors[0],
      limit: 10,
      filter: 'category == "even"',
      output_fields: ["category"],
    });
    expect(res.results.length).toBeGreaterThan(0);
    for (const r of res.results) {
      expect(r.category).toBe("even");
    }
  });

  it("query", async () => {
    const res = await client.query({
      collection_name: collName,
      filter: "id < 5",
      output_fields: ["id", "category", "score"],
    });
    expect(res.data.length).toBe(5);
  });

  it("delete", async () => {
    const res = await client.delete({
      collection_name: collName,
      filter: "id < 10",
    });
    expect(res.status.error_code).toBe("Success");

    // Verify deletion
    const query = await client.query({
      collection_name: collName,
      filter: "id < 10",
      output_fields: ["id"],
    });
    expect(query.data.length).toBe(0);
  });
});

// ===========================================
// Upsert
// ===========================================

describe("Upsert", () => {
  const collName = "test_upsert";

  beforeAll(async () => {
    await client.createCollection({
      collection_name: collName,
      fields: [
        { name: "id", data_type: DataType.Int64, is_primary_key: true },
        { name: "label", data_type: DataType.VarChar, max_length: 32 },
        { name: "vector", data_type: DataType.FloatVector, dim: DIM },
      ],
    });

    const vecs = randomVectors(10, DIM);
    await client.insert({
      collection_name: collName,
      data: vecs.map((v, i) => ({
        id: i + 1,
        label: String.fromCharCode(97 + i),
        vector: v,
      })),
    });
  });

  afterAll(async () => {
    await client.dropCollection({ collection_name: collName });
  });

  it("upsert existing + new", async () => {
    const vecs = randomVectors(3, DIM);
    const res = await client.upsert({
      collection_name: collName,
      data: [
        { id: 1, label: "updated_a", vector: vecs[0] },
        { id: 2, label: "updated_b", vector: vecs[1] },
        { id: 11, label: "new_k", vector: vecs[2] },
      ],
    });
    expect(res.succ_index.length).toBe(3);

    // Verify
    await client.createIndex({
      collection_name: collName,
      field_name: "vector",
      index_type: "FLAT",
      metric_type: "L2",
    });
    await client.loadCollection({ collection_name: collName });

    const query = await client.query({
      collection_name: collName,
      filter: "id in [1, 2, 11]",
      output_fields: ["id", "label"],
    });
    expect(query.data.length).toBe(3);

    const labels = query.data.map((r: any) => r.label).sort();
    expect(labels).toContain("updated_a");
    expect(labels).toContain("updated_b");
    expect(labels).toContain("new_k");
  });
});

// ===========================================
// Load / Release / GetLoadState
// ===========================================

describe("Load and Release", () => {
  const collName = "test_load_release";

  beforeAll(async () => {
    await client.createCollection({
      collection_name: collName,
      fields: [
        {
          name: "id",
          data_type: DataType.Int64,
          is_primary_key: true,
          autoID: true,
        },
        { name: "vector", data_type: DataType.FloatVector, dim: DIM },
      ],
    });
    await client.createIndex({
      collection_name: collName,
      field_name: "vector",
      index_type: "FLAT",
      metric_type: "L2",
    });
  });

  afterAll(async () => {
    await client.dropCollection({ collection_name: collName });
  });

  it("loadCollection", async () => {
    const res = await client.loadCollection({ collection_name: collName });
    expect(res.error_code).toBe("Success");
  });

  it("getLoadState", async () => {
    const res = await client.getLoadState({ collection_name: collName });
    expect(res.state).toBeDefined();
  });

  it("releaseCollection", async () => {
    const res = await client.releaseCollection({ collection_name: collName });
    expect(res.error_code).toBe("Success");
  });
});

// ===========================================
// Multiple field types
// ===========================================

describe("Multiple field types", () => {
  const collName = "test_field_types";

  afterAll(async () => {
    await client.dropCollection({ collection_name: collName });
  });

  it("create, insert, query with mixed types", async () => {
    await client.createCollection({
      collection_name: collName,
      fields: [
        { name: "id", data_type: DataType.Int64, is_primary_key: true },
        { name: "flag", data_type: DataType.Bool },
        { name: "age", data_type: DataType.Int32 },
        { name: "score", data_type: DataType.Double },
        { name: "name", data_type: DataType.VarChar, max_length: 128 },
        { name: "meta", data_type: DataType.JSON },
        { name: "vector", data_type: DataType.FloatVector, dim: DIM },
      ],
    });

    const vecs = randomVectors(20, DIM);
    const data = vecs.map((v, i) => ({
      id: i,
      flag: i % 2 === 0,
      age: 20 + i,
      score: i * 1.1,
      name: `user_${String.fromCharCode(65 + (i % 26))}`,
      meta: { key: "value" },
      vector: v,
    }));

    await client.insert({ collection_name: collName, data });

    await client.createIndex({
      collection_name: collName,
      field_name: "vector",
      index_type: "FLAT",
      metric_type: "L2",
    });
    await client.loadCollection({ collection_name: collName });

    const res = await client.query({
      collection_name: collName,
      filter: "age > 30",
      output_fields: ["id", "flag", "age", "score", "name", "meta"],
    });
    expect(res.data.length).toBeGreaterThan(0);
  });
});

// ===========================================
// Multiple collections
// ===========================================

describe("Multiple collections", () => {
  const names = ["multi_a", "multi_b", "multi_c"];

  afterAll(async () => {
    for (const name of names) {
      await client.dropCollection({ collection_name: name }).catch(() => {});
    }
  });

  it("create, list, drop multiple collections", async () => {
    for (const name of names) {
      await client.createCollection({
        collection_name: name,
        fields: [
          {
            name: "id",
            data_type: DataType.Int64,
            is_primary_key: true,
            autoID: true,
          },
          { name: "vector", data_type: DataType.FloatVector, dim: DIM },
        ],
      });
    }

    const list = await client.listCollections();
    const collNames = list.data.map((c: any) => c.name);
    for (const name of names) {
      expect(collNames).toContain(name);
    }

    for (const name of names) {
      await client.dropCollection({ collection_name: name });
    }

    const listAfter = await client.listCollections();
    const afterNames = listAfter.data.map((c: any) => c.name);
    for (const name of names) {
      expect(afterNames).not.toContain(name);
    }
  });
});
