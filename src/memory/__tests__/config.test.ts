import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { loadMemoryConfig } from "../config.ts";

describe("loadMemoryConfig env overrides", () => {
	const origQdrant = process.env.QDRANT_URL;
	const origQdrantKey = process.env.QDRANT_API_KEY;
	const origOpenai = process.env.OPENAI_API_KEY;
	const origModel = process.env.EMBEDDING_MODEL;

	beforeEach(() => {
		process.env.QDRANT_URL = undefined;
		process.env.QDRANT_API_KEY = undefined;
		process.env.OPENAI_API_KEY = undefined;
		process.env.EMBEDDING_MODEL = undefined;
	});

	afterEach(() => {
		process.env.QDRANT_URL = origQdrant;
		process.env.QDRANT_API_KEY = origQdrantKey;
		process.env.OPENAI_API_KEY = origOpenai;
		process.env.EMBEDDING_MODEL = origModel;
	});

	test("uses YAML defaults when no env vars set", () => {
		const config = loadMemoryConfig();
		expect(config.qdrant.url).toBe("http://localhost:6333");
		expect(config.embeddings.provider).toBe("openai");
		expect(config.embeddings.model).toBe("text-embedding-3-small");
	});

	test("QDRANT_URL env var overrides YAML config", () => {
		process.env.QDRANT_URL = "https://abc.cloud.qdrant.io:6333";
		const config = loadMemoryConfig();
		expect(config.qdrant.url).toBe("https://abc.cloud.qdrant.io:6333");
	});

	test("QDRANT_API_KEY env var overrides YAML config", () => {
		process.env.QDRANT_API_KEY = "test-qdrant-key";
		const config = loadMemoryConfig();
		expect(config.qdrant.api_key).toBe("test-qdrant-key");
	});

	test("OPENAI_API_KEY env var overrides YAML config", () => {
		process.env.OPENAI_API_KEY = "sk-test-key";
		const config = loadMemoryConfig();
		expect(config.embeddings.api_key).toBe("sk-test-key");
	});

	test("EMBEDDING_MODEL env var overrides YAML config", () => {
		process.env.EMBEDDING_MODEL = "text-embedding-3-large";
		const config = loadMemoryConfig();
		expect(config.embeddings.model).toBe("text-embedding-3-large");
	});

	test("env vars override for missing YAML file (defaults path)", () => {
		process.env.QDRANT_URL = "https://abc.cloud.qdrant.io:6333";
		process.env.OPENAI_API_KEY = "sk-test-key";
		const config = loadMemoryConfig("config/nonexistent.yaml");
		expect(config.qdrant.url).toBe("https://abc.cloud.qdrant.io:6333");
		expect(config.embeddings.api_key).toBe("sk-test-key");
	});

	test("non-memory fields are preserved when env vars set", () => {
		process.env.QDRANT_URL = "https://abc.cloud.qdrant.io:6333";
		const config = loadMemoryConfig();
		expect(config.collections.episodes).toBe("episodes");
		expect(config.embedding.dimensions).toBe(1536);
		expect(config.context.max_tokens).toBe(50000);
	});
});
