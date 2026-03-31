import type { MemoryConfig } from "../config/types.ts";
import type { SparseVector } from "./types.ts";

const OPENAI_EMBEDDINGS_URL = "https://api.openai.com/v1/embeddings";

type OpenAIEmbeddingResponse = {
	data: { embedding: number[]; index: number }[];
	usage: { prompt_tokens: number; total_tokens: number };
};

export class EmbeddingClient {
	private apiKey: string;
	private model: string;

	constructor(config: MemoryConfig) {
		const key = config.embeddings.api_key;
		if (!key) {
			throw new Error("Embedding API key is required. Set OPENAI_API_KEY environment variable.");
		}
		this.apiKey = key;
		this.model = config.embeddings.model;
	}

	async embed(text: string): Promise<number[]> {
		const response = await fetch(OPENAI_EMBEDDINGS_URL, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${this.apiKey}`,
			},
			body: JSON.stringify({ model: this.model, input: text }),
		});

		if (!response.ok) {
			const body = await response.text().catch(() => "");
			throw new Error(`OpenAI embedding failed (${response.status}): ${body || response.statusText}`);
		}

		const data = (await response.json()) as OpenAIEmbeddingResponse;

		if (!data.data?.[0]?.embedding) {
			throw new Error("OpenAI returned empty embeddings.");
		}

		return data.data[0].embedding;
	}

	async embedBatch(texts: string[]): Promise<number[][]> {
		const response = await fetch(OPENAI_EMBEDDINGS_URL, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${this.apiKey}`,
			},
			body: JSON.stringify({ model: this.model, input: texts }),
		});

		if (!response.ok) {
			const body = await response.text().catch(() => "");
			throw new Error(`OpenAI batch embedding failed (${response.status}): ${body || response.statusText}`);
		}

		const data = (await response.json()) as OpenAIEmbeddingResponse;

		if (!data.data || data.data.length !== texts.length) {
			throw new Error(`OpenAI returned ${data.data?.length ?? 0} embeddings for ${texts.length} inputs`);
		}

		// OpenAI returns results sorted by index
		return data.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
	}

	async isHealthy(): Promise<boolean> {
		return !!this.apiKey;
	}
}

/**
 * Generate a BM25-style sparse vector from text.
 * Tokenizes on word boundaries, computes term frequencies,
 * and maps tokens to stable integer indices via a simple hash.
 */
export function textToSparseVector(text: string): SparseVector {
	const tokens = text
		.toLowerCase()
		.replace(/[^\w\s]/g, " ")
		.split(/\s+/)
		.filter((t) => t.length > 1);

	if (tokens.length === 0) {
		return { indices: [], values: [] };
	}

	const tf = new Map<string, number>();
	for (const token of tokens) {
		tf.set(token, (tf.get(token) ?? 0) + 1);
	}

	const indices: number[] = [];
	const values: number[] = [];

	for (const [token, count] of tf.entries()) {
		indices.push(stableHash(token));
		values.push(count / tokens.length);
	}

	return { indices, values };
}

/**
 * Stable hash for token to sparse vector index mapping.
 * Uses FNV-1a to produce a positive 32-bit integer.
 */
function stableHash(str: string): number {
	let hash = 0x811c9dc5;
	for (let i = 0; i < str.length; i++) {
		hash ^= str.charCodeAt(i);
		hash = (hash * 0x01000193) >>> 0;
	}
	return hash >>> 0;
}
