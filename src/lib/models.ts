import { openai, anthropic } from "@inngest/agent-kit";

/**
 * Provider-agnostic model selection.
 *
 * Model IDs were previously hardcoded at three call sites in
 * `src/inngest/functions.ts`, one carrying the comment
 * "// Updated to use a valid model". See docs/AUDIT.md S5.
 *
 * Two reasons this matters beyond tidiness:
 *
 *   1. Model routing is a named intervention in docs/PLAN.md. You cannot
 *      A/B a model that is spelled out in three places.
 *   2. Every value here is environment-overridable, so a variant can be
 *      tried without a deploy.
 *
 * POLICY: LIGHTEST MODEL THAT CLEARS THE BAR.
 *
 * Each role's candidate list is ordered cheapest first, and the first entry
 * is the default. Start light and let measurement justify an upgrade, rather
 * than starting heavy and never finding out whether it was needed.
 *
 * That is not a cost-saving footnote — it is the experiment. "Does the
 * bigger coder model actually raise build success rate, and by enough to
 * pay for the latency?" is exactly the question the harness in docs/PLAN.md
 * exists to answer. These lists are its variant surface.
 */

export type Provider = "openai" | "anthropic";

/**
 * What each agent is for. Kept separate because they have genuinely
 * different requirements: the coder writes and repairs a whole project,
 * the other two summarise a string.
 */
export type ModelRole = "coder" | "titler" | "responder";

export type ModelChoice = {
  id: string;
  /** Cheapest first. The `light` entry for a role is its default. */
  tier: "light" | "balanced" | "heavy";
  note: string;
};

type RoleCandidates = Record<ModelRole, readonly ModelChoice[]>;

/** https://developers.openai.com/api/docs/models */
const OPENAI_CANDIDATES: RoleCandidates = {
  coder: [
    {
      id: "gpt-5.6-terra",
      tier: "light",
      note: "RECOMMENDED. Production default of the 5.6 family. Start here.",
    },
    {
      id: "gpt-5.3-codex",
      tier: "balanced",
      note: "Purpose-built for agentic coding. First upgrade to test.",
    },
    {
      id: "gpt-5.6-sol",
      tier: "heavy",
      note: "Flagship. Only if measurement shows Terra and Codex both fall short.",
    },
  ],
  titler: [
    {
      id: "gpt-5.6-luna",
      tier: "light",
      note: "RECOMMENDED. Classification and extraction tier. Ample for a title.",
    },
    { id: "gpt-5.6-terra", tier: "balanced", note: "Overkill for this role." },
  ],
  responder: [
    {
      id: "gpt-5.6-luna",
      tier: "light",
      note: "RECOMMENDED. Summarising one string back to the user.",
    },
    { id: "gpt-5.6-terra", tier: "balanced", note: "If replies read as thin." },
  ],
};

/** https://docs.claude.com/en/docs/about-claude/models */
const ANTHROPIC_CANDIDATES: RoleCandidates = {
  coder: [
    {
      id: "claude-haiku-4-5-20251001",
      tier: "light",
      note: "RECOMMENDED. Cheapest viable coder. Establish the baseline here.",
    },
    {
      id: "claude-sonnet-5",
      tier: "balanced",
      note: "First upgrade to test against the Haiku baseline.",
    },
    {
      id: "claude-opus-5",
      tier: "heavy",
      note: "Only with measured justification. Expensive and slower.",
    },
  ],
  titler: [
    {
      id: "claude-haiku-4-5-20251001",
      tier: "light",
      note: "RECOMMENDED. No reason to go heavier for a title.",
    },
    { id: "claude-sonnet-5", tier: "balanced", note: "Overkill for this role." },
  ],
  responder: [
    {
      id: "claude-haiku-4-5-20251001",
      tier: "light",
      note: "RECOMMENDED. No reason to go heavier for a summary.",
    },
    { id: "claude-sonnet-5", tier: "balanced", note: "If replies read as thin." },
  ],
};

export const CANDIDATES: Record<Provider, RoleCandidates> = {
  openai: OPENAI_CANDIDATES,
  anthropic: ANTHROPIC_CANDIDATES,
};

/** The recommended (lightest) choice for a role. */
export const recommendedFor = (
  role: ModelRole,
  provider: Provider,
): ModelChoice => CANDIDATES[provider][role][0];

const isProvider = (value: string | undefined): value is Provider =>
  value === "openai" || value === "anthropic";

/** Used when nothing else says otherwise. */
export const DEFAULT_PROVIDER: Provider = "anthropic";

/** Provider for the whole run. Per-role override is deliberately not supported yet. */
export const getProvider = (override?: string): Provider => {
  const candidate = override ?? process.env.VIBE_MODEL_PROVIDER;
  return isProvider(candidate) ? candidate : DEFAULT_PROVIDER;
};

/**
 * Which provider a user-supplied key belongs to.
 *
 * Without this, changing the default provider silently breaks bring-your-own
 * key: a user pastes an OpenAI key, the run defaults to Anthropic, and the
 * key is sent to the wrong API. The result is a 401 whose message says
 * nothing about providers, on a path the user cannot debug.
 *
 * Prefix is the only signal available before making a request, and it is
 * reliable: Anthropic keys begin `sk-ant-`, OpenAI keys begin `sk-` and
 * do not. Returns undefined for anything unrecognised rather than guessing.
 */
export const providerForKey = (apiKey: string): Provider | undefined => {
  const trimmed = apiKey.trim();
  if (trimmed.startsWith("sk-ant-")) return "anthropic";
  if (trimmed.startsWith("sk-")) return "openai";
  return undefined;
};

const ROLE_ENV: Record<ModelRole, string> = {
  coder: "VIBE_MODEL_CODER",
  titler: "VIBE_MODEL_TITLER",
  responder: "VIBE_MODEL_RESPONDER",
};

export const getModelId = (role: ModelRole, provider: Provider): string =>
  process.env[ROLE_ENV[role]] ?? recommendedFor(role, provider).id;

/**
 * Anthropic's API requires `max_tokens` on every request; OpenAI's does not.
 * Forgetting it is a request-time 400, so it is set here rather than left to
 * each call site to remember.
 */
const ANTHROPIC_MAX_TOKENS = Number.parseInt(
  process.env.VIBE_ANTHROPIC_MAX_TOKENS ?? "8192",
  10,
);

/** Low by default: the coder should be reproducible, not creative. */
const CODER_TEMPERATURE = Number.parseFloat(
  process.env.VIBE_CODER_TEMPERATURE ?? "0.1",
);

export const envKeyFor = (provider: Provider): string | undefined =>
  provider === "anthropic"
    ? process.env.ANTHROPIC_API_KEY
    : process.env.OPENAI_API_KEY;

/**
 * Does this deployment have a provider key of its own?
 *
 * WHY THE UI ASKS RATHER THAN ASSUMES
 *
 * Whether a user's key is required is a property of the deployment, not of
 * the product. Locally there is a key in `.env` and evals run against it;
 * in production there is none and every user supplies their own. The same
 * code serves both.
 *
 * Hardcoding "(Optional)" in the form was wrong in production. Hardcoding
 * "(Required)" would be wrong locally. Either way the label is an
 * assertion, and an assertion about configuration is the kind that goes
 * stale silently — it keeps rendering the old answer after the
 * configuration moves.
 *
 * So the server reports what is true and the form renders that. Server-only:
 * it reads `process.env`, and the answer is a boolean, never the key.
 */
export const hasServerKey = (): boolean =>
  !!envKeyFor("anthropic") || !!envKeyFor("openai");

export type ModelOptions = {
  role: ModelRole;
  /** Per-request key, e.g. a user-supplied one. Falls back to the environment. */
  apiKey?: string;
  /** Overrides VIBE_MODEL_PROVIDER for this call. */
  provider?: Provider;
};

/**
 * Build the AgentKit model adapter for a role.
 *
 * Throws when no key is available, rather than letting the request fail
 * deep inside the agent loop where the cause is hard to read.
 */
export const modelFor = ({ role, apiKey, provider }: ModelOptions) => {
  const resolvedProvider = getProvider(provider);
  const resolvedKey = apiKey ?? envKeyFor(resolvedProvider);

  if (!resolvedKey) {
    throw new Error(
      `No API key available for provider "${resolvedProvider}". ` +
        `Set ${resolvedProvider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY"} ` +
        `or supply a key with the request.`,
    );
  }

  const model = getModelId(role, resolvedProvider);

  if (resolvedProvider === "anthropic") {
    return anthropic({
      model,
      apiKey: resolvedKey,
      defaultParameters: {
        max_tokens: ANTHROPIC_MAX_TOKENS,
        ...(role === "coder" ? { temperature: CODER_TEMPERATURE } : {}),
      },
    });
  }

  return openai({
    model,
    apiKey: resolvedKey,
    ...(role === "coder"
      ? { defaultParameters: { temperature: CODER_TEMPERATURE } }
      : {}),
  });
};

/** Exported for tests and for logging alongside a run. */
export const describeModels = (provider: Provider) => ({
  provider,
  coder: getModelId("coder", provider),
  titler: getModelId("titler", provider),
  responder: getModelId("responder", provider),
});
