/**
 * Does the configured provider, key and model actually work?
 *
 *   npm run check:model
 *   npm run check:model model=claude-sonnet-5
 *
 * A bisect tool, not part of the harness. When a run produces zero files in
 * twelve seconds there are two candidate causes — the credentials and model
 * are wrong, or AgentKit's integration is wrong — and they need very
 * different fixes. This calls the provider's HTTP API directly, with no
 * AgentKit in the path, so a failure here rules one of them out.
 *
 * It also asks for a tool call, because that is what the coder agent
 * actually needs. A model that answers prose happily can still fail to
 * emit tool calls, which would look exactly like "wrote no files".
 */

import { readFileSync } from "node:fs";

import { getModelId, getProvider, type Provider } from "../src/lib/models";

const bare = (token: string) => token.replace(/^-+/, "");

const arg = (name: string): string | undefined => {
  const tokens = process.argv.slice(2).map(bare);
  const pair = tokens.find((t) => t.startsWith(`${name}=`));
  return pair?.slice(name.length + 1);
};

/**
 * Identify a key without printing it. Same shape every provider console
 * shows, so it can be compared against the dashboard by eye.
 */
const fingerprint = (key: string): string =>
  `${key.slice(0, 7)}…${key.slice(-4)} (${key.length} chars)`;

/**
 * WHERE DID THIS KEY COME FROM?
 *
 * The trap: **neither Next.js nor Node's `--env-file` overrides a variable
 * already present in the environment.** They fill gaps. So a stale
 * `ANTHROPIC_API_KEY` in Windows user or machine environment variables
 * silently wins over `.env`, for the app and for every script, and nothing
 * anywhere says which one was used.
 *
 * The symptom is billing appearing on an account you are not looking at,
 * with no error and no clue in any log.
 */
const reportKeyProvenance = (provider: string) => {
  const name = provider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY";

  const inProcess = process.env[name];

  let fromFile: string | undefined;
  try {
    const envFile = readFileSync(".env", "utf8");
    fromFile = envFile
      .split("\n")
      .find((line) => line.trim().startsWith(`${name}=`))
      ?.split("=")
      .slice(1)
      .join("=")
      .trim()
      .replace(/^["']|["']$/g, "");
  } catch {
    fromFile = undefined;
  }

  console.log("key provenance");
  console.log(`  in process   ${inProcess ? fingerprint(inProcess) : "not set"}`);
  console.log(`  in .env      ${fromFile ? fingerprint(fromFile) : "not set"}`);

  if (inProcess && fromFile && inProcess !== fromFile) {
    console.log(
      `\n  ⚠ THESE DIFFER. The process value wins — .env does not override an\n` +
        `    environment variable that is already set. Billing is going to the\n` +
        `    account that owns the "in process" key.\n\n` +
        `    Find where it is set:\n` +
        `      [Environment]::GetEnvironmentVariable('${name}','User')\n` +
        `      [Environment]::GetEnvironmentVariable('${name}','Machine')\n\n` +
        `    Remove the user-level one with:\n` +
        `      [Environment]::SetEnvironmentVariable('${name}',$null,'User')\n` +
        `    then open a new terminal — existing shells keep the old value.`,
    );
  } else if (inProcess && !fromFile) {
    console.log(
      `\n  ⚠ The key is coming from the environment, not from .env.\n` +
        `    Nothing in this repo controls which account it bills.`,
    );
  }

  console.log("");
};

const checkAnthropic = async (model: string, apiKey: string) => {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 256,
      messages: [
        { role: "user", content: "Write a file called hello.txt containing the word hi." },
      ],
      tools: [
        {
          name: "write_file",
          description: "Write a file",
          input_schema: {
            type: "object",
            properties: {
              path: { type: "string" },
              content: { type: "string" },
            },
            required: ["path", "content"],
          },
        },
      ],
    }),
  });

  return response;
};

const checkOpenAI = async (model: string, apiKey: string) => {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "user", content: "Write a file called hello.txt containing the word hi." },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "write_file",
            description: "Write a file",
            parameters: {
              type: "object",
              properties: {
                path: { type: "string" },
                content: { type: "string" },
              },
              required: ["path", "content"],
            },
          },
        },
      ],
    }),
  });

  return response;
};

const main = async () => {
  const provider: Provider = (arg("provider") as Provider) ?? getProvider();
  const model = arg("model") ?? getModelId("coder", provider);

  const apiKey =
    provider === "anthropic"
      ? process.env.ANTHROPIC_API_KEY
      : process.env.OPENAI_API_KEY;

  console.log(`provider  ${provider}`);
  console.log(`model     ${model}`);
  console.log(`key       ${apiKey ? fingerprint(apiKey) : "MISSING"}\n`);

  reportKeyProvenance(provider);

  if (!apiKey) {
    console.error("No API key for that provider. Nothing to test.");
    process.exit(1);
  }

  const response =
    provider === "anthropic"
      ? await checkAnthropic(model, apiKey)
      : await checkOpenAI(model, apiKey);

  const body = await response.text();

  console.log(`HTTP ${response.status} ${response.statusText}\n`);

  if (!response.ok) {
    // The provider's own error text is far more specific than anything
    // AgentKit surfaces through three layers of wrapping.
    console.error(body.slice(0, 2000));
    console.error("\nThe credentials or the model name are the problem.");
    console.error("AgentKit is not involved in this request.");
    process.exit(1);
  }

  const parsed = JSON.parse(body) as Record<string, unknown>;

  // Did it actually try to call the tool? Prose-only is a different failure
  // from an error, and it is the one that produces zero files silently.
  const usedTool = body.includes("write_file");

  console.log(usedTool ? "Tool call attempted." : "NO TOOL CALL — prose only.");
  console.log(`stop reason: ${JSON.stringify(parsed.stop_reason ?? parsed.choices ?? "?").slice(0, 200)}`);

  if (!usedTool) {
    console.error(
      "\nThe model answered without calling the tool. A coder agent that " +
        "cannot emit tool calls writes no files and fails in about the time " +
        "one request takes.",
    );
    process.exit(1);
  }

  console.log("\nProvider, key, model and tool calling all work.");
  console.log("If runs still produce no files, the problem is in AgentKit's wiring.");
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
