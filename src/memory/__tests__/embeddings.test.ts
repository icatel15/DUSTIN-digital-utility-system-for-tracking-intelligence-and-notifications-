import { afterAll, describe, expect, mock, test } from "bun:test";
import type { MemoryConfig } from "../../config/types.ts";
import { EmbeddingClient, textToSparseVector } from "../embeddings.ts";

const TEST_CONFIG: MemoryConfig = {
	qdrant: { url: "http://localhost:6333" },
	embeddings: { provider: "openai", api_key: "test-key", model: "text-embedding-3-small" },
	collections: { episodes: "episodes", semantic_facts: "semantic_facts", procedures: "procedures" },
	embedding: { dimensions: 1536, batch_size: 32 },
	context: { max_tokens: 50000, episode_limit: 10, fact_limit: 20, procedure_limit: 5 },
};

function make1536dVector(): number[] {
	return Array.from({ length: 1536 }, (_, i) => Math.sin(i * 0.01));
}

describe("EmbeddingClient", () => {
	const originalFetch = globalThis.fetch;

	afterAll(() => {
		globalThis.fetch = originalFetch;
	});

	test("embed() returns embedding vector from OpenAI response", async () => {
		const mockVector = make1536dVector();

		globalThis.fetch = mock(() =>
			Promise.resolve(
				new Response(
					JSON.stringify({ data: [{ embedding: mockVector, index: 0 }], usage: { prompt_tokens: 5, total_tokens: 5 } }),
					{
						status: 200,
						headers: { "Content-Type": "application/json" },
					},
				),
			),
		) as unknown as typeof fetch;

		const client = new EmbeddingClient(TEST_CONFIG);
		const result = await client.embed("test text");

		expect(result).toEqual(mockVector);
		expect(result.length).toBe(1536);
	});

	test("embed() throws on HTTP error with helpful message", async () => {
		globalThis.fetch = mock(() =>
			Promise.resolve(new Response("invalid api key", { status: 401 })),
		) as unknown as typeof fetch;

		const client = new EmbeddingClient(TEST_CONFIG);
		await expect(client.embed("test")).rejects.toThrow("OpenAI embedding failed (401)");
	});

	test("embed() throws on empty embeddings response", async () => {
		globalThis.fetch = mock(() =>
			Promise.resolve(
				new Response(JSON.stringify({ data: [], usage: { prompt_tokens: 0, total_tokens: 0 } }), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				}),
			),
		) as unknown as typeof fetch;

		const client = new EmbeddingClient(TEST_CONFIG);
		await expect(client.embed("test")).rejects.toThrow("empty embeddings");
	});

	test("embedBatch() returns multiple vectors sorted by index", async () => {
		const vec1 = make1536dVector();
		const vec2 = make1536dVector().map((v) => v + 0.5);

		globalThis.fetch = mock(() =>
			Promise.resolve(
				new Response(
					JSON.stringify({
						data: [
							{ embedding: vec2, index: 1 },
							{ embedding: vec1, index: 0 },
						],
						usage: { prompt_tokens: 10, total_tokens: 10 },
					}),
					{
						status: 200,
						headers: { "Content-Type": "application/json" },
					},
				),
			),
		) as unknown as typeof fetch;

		const client = new EmbeddingClient(TEST_CONFIG);
		const results = await client.embedBatch(["text one", "text two"]);

		expect(results.length).toBe(2);
		expect(results[0]).toEqual(vec1);
		expect(results[1]).toEqual(vec2);
	});

	test("embedBatch() throws on mismatched count", async () => {
		const vec1 = make1536dVector();

		globalThis.fetch = mock(() =>
			Promise.resolve(
				new Response(
					JSON.stringify({ data: [{ embedding: vec1, index: 0 }], usage: { prompt_tokens: 5, total_tokens: 5 } }),
					{
						status: 200,
						headers: { "Content-Type": "application/json" },
					},
				),
			),
		) as unknown as typeof fetch;

		const client = new EmbeddingClient(TEST_CONFIG);
		await expect(client.embedBatch(["one", "two", "three"])).rejects.toThrow("1 embeddings for 3 inputs");
	});

	test("isHealthy() returns true when API key is set", async () => {
		const client = new EmbeddingClient(TEST_CONFIG);
		expect(await client.isHealthy()).toBe(true);
	});

	test("constructor throws when API key is missing", () => {
		const noKeyConfig: MemoryConfig = {
			...TEST_CONFIG,
			embeddings: { provider: "openai", model: "text-embedding-3-small" },
		};
		expect(() => new EmbeddingClient(noKeyConfig)).toThrow("API key is required");
	});
});

describe("textToSparseVector", () => {
	test("generates sparse vector from text", () => {
		const result = textToSparseVector("the quick brown fox jumps over the lazy dog");

		expect(result.indices.length).toBeGreaterThan(0);
		expect(result.values.length).toBe(result.indices.length);
		// All values should be positive TF scores
		for (const v of result.values) {
			expect(v).toBeGreaterThan(0);
			expect(v).toBeLessThanOrEqual(1);
		}
	});

	test("handles empty text", () => {
		const result = textToSparseVector("");
		expect(result.indices.length).toBe(0);
		expect(result.values.length).toBe(0);
	});

	test("produces consistent hashes for same tokens", () => {
		const a = textToSparseVector("hello world");
		const b = textToSparseVector("hello world");
		expect(a.indices).toEqual(b.indices);
		expect(a.values).toEqual(b.values);
	});

	test("produces different hashes for different tokens", () => {
		const a = textToSparseVector("hello world");
		const b = textToSparseVector("goodbye moon");
		// At least some indices should differ
		const aSet = new Set(a.indices);
		const bSet = new Set(b.indices);
		const intersection = [...aSet].filter((x) => bSet.has(x));
		expect(intersection.length).toBeLessThan(a.indices.length);
	});

	test("filters single-character tokens", () => {
		const result = textToSparseVector("I am a b c test");
		// "I", "a", "b", "c" are single chars and should be filtered
		expect(result.indices.length).toBe(2); // "am" and "test"
	});
});
