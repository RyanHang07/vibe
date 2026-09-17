import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CANDIDATES,
  DEFAULT_PROVIDER,
  describeModels,
  envKeyFor,
  getModelId,
  getProvider,
  providerForKey,
  recommendedFor,
} from "./models";

/**
 * `modelFor` is not tested here: it constructs AgentKit adapters, which is
 * the library's job, not ours. What is worth testing is the selection logic
 * around it — provider resolution, env overrides, and the key lookup — since
 * that is what a model-routing intervention will change.
 */

const ORIGINAL_ENV = process.env;

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
  vi.unstubAllEnvs();
});

describe("getProvider", () => {
  it("defaults to anthropic when nothing is set", () => {
    delete process.env.VIBE_MODEL_PROVIDER;
    expect(getProvider()).toBe(DEFAULT_PROVIDER);
    expect(getProvider()).toBe("anthropic");
  });

  it("reads VIBE_MODEL_PROVIDER", () => {
    process.env.VIBE_MODEL_PROVIDER = "openai";
    expect(getProvider()).toBe("openai");
  });

  it("falls back rather than throwing on an unknown provider", () => {
    process.env.VIBE_MODEL_PROVIDER = "notaprovider";
    expect(getProvider()).toBe(DEFAULT_PROVIDER);
  });

  it("lets an explicit argument win over the environment", () => {
    process.env.VIBE_MODEL_PROVIDER = "anthropic";
    expect(getProvider("openai")).toBe("openai");
  });
});

describe("providerForKey", () => {
  // Regression guard for the failure mode introduced by changing the
  // default provider: a pasted OpenAI key sent to Anthropic returns a 401
  // that says nothing about providers.
  it("recognises an Anthropic key by its longer prefix", () => {
    expect(providerForKey("sk-ant-api03-" + "x".repeat(40))).toBe("anthropic");
  });

  it("recognises an OpenAI key", () => {
    expect(providerForKey("sk-proj-" + "x".repeat(40))).toBe("openai");
  });

  it("checks the anthropic prefix before the openai one", () => {
    // Both start with `sk-`. Order of checks is the whole correctness
    // argument here, so it gets its own test.
    const anthropicKey = "sk-ant-" + "x".repeat(40);
    expect(providerForKey(anthropicKey)).not.toBe("openai");
  });

  it("returns undefined rather than guessing at something unrecognised", () => {
    expect(providerForKey("not-a-key")).toBeUndefined();
    expect(providerForKey("")).toBeUndefined();
  });

  it("tolerates surrounding whitespace from a paste", () => {
    expect(providerForKey("  sk-ant-" + "x".repeat(40) + "  ")).toBe("anthropic");
  });
});

describe("getModelId", () => {
  it("returns a different default per provider", () => {
    delete process.env.VIBE_MODEL_CODER;
    expect(getModelId("coder", "openai")).not.toBe(
      getModelId("coder", "anthropic"),
    );
  });

  it("lets an env override win over the provider default", () => {
    process.env.VIBE_MODEL_CODER = "some-experimental-model";
    expect(getModelId("coder", "openai")).toBe("some-experimental-model");
    expect(getModelId("coder", "anthropic")).toBe("some-experimental-model");
  });

  it("scopes overrides to their own role", () => {
    process.env.VIBE_MODEL_TITLER = "cheap-model";
    expect(getModelId("titler", "openai")).toBe("cheap-model");
    expect(getModelId("coder", "openai")).not.toBe("cheap-model");
  });

  it("never returns an empty id for any role", () => {
    delete process.env.VIBE_MODEL_CODER;
    delete process.env.VIBE_MODEL_TITLER;
    delete process.env.VIBE_MODEL_RESPONDER;

    for (const provider of ["openai", "anthropic"] as const) {
      const models = describeModels(provider);
      expect(models.coder.length).toBeGreaterThan(0);
      expect(models.titler.length).toBeGreaterThan(0);
      expect(models.responder.length).toBeGreaterThan(0);
    }
  });
});

describe("lightest-first policy", () => {
  const ROLES = ["coder", "titler", "responder"] as const;
  const PROVIDERS = ["openai", "anthropic"] as const;

  it("defaults every role to its light tier", () => {
    for (const provider of PROVIDERS) {
      for (const role of ROLES) {
        expect(recommendedFor(role, provider).tier).toBe("light");
      }
    }
  });

  it("orders candidates cheapest first", () => {
    const rank = { light: 0, balanced: 1, heavy: 2 } as const;

    for (const provider of PROVIDERS) {
      for (const role of ROLES) {
        const tiers = CANDIDATES[provider][role].map((c) => rank[c.tier]);
        const sorted = [...tiers].sort((a, b) => a - b);
        expect(tiers).toEqual(sorted);
      }
    }
  });

  it("offers at least one upgrade path per role", () => {
    for (const provider of PROVIDERS) {
      for (const role of ROLES) {
        expect(CANDIDATES[provider][role].length).toBeGreaterThan(1);
      }
    }
  });

  it("has no duplicate ids within a role", () => {
    for (const provider of PROVIDERS) {
      for (const role of ROLES) {
        const ids = CANDIDATES[provider][role].map((c) => c.id);
        expect(new Set(ids).size).toBe(ids.length);
      }
    }
  });
});

describe("envKeyFor", () => {
  it("reads the provider's own variable, not the other one", () => {
    process.env.OPENAI_API_KEY = "sk-openai";
    process.env.ANTHROPIC_API_KEY = "sk-ant";

    expect(envKeyFor("openai")).toBe("sk-openai");
    expect(envKeyFor("anthropic")).toBe("sk-ant");
  });

  it("returns undefined when the provider's key is absent", () => {
    delete process.env.ANTHROPIC_API_KEY;
    process.env.OPENAI_API_KEY = "sk-openai";
    expect(envKeyFor("anthropic")).toBeUndefined();
  });
});
