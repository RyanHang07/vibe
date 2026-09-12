"use client";

import { useState, useEffect, useCallback } from "react";
import { Eye, EyeOff, Key, ShieldAlert, X } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * NOTE ON THE SECURITY COPY BELOW.
 *
 * An earlier version of this component told the user their key was
 * "never sent to our servers". That was false: the key is sent as a tRPC
 * input, placed inside an Inngest event payload, and is therefore persisted
 * and visible in Inngest's dashboard. See docs/AUDIT.md S1.
 *
 * The copy now describes what the code actually does. When the plumbing is
 * fixed (key held server-side, only a reference passed through the event),
 * update this copy in the same commit as the mechanism — not before.
 */

export type ApiKeyInputProps = {
  /** Called with the trimmed key when it looks valid, or null when it doesn't. */
  onApiKeyChange?: (apiKey: string | null) => void;
  placeholder?: string;
  className?: string;
};

/** OpenAI keys start with `sk-`. Length is a weak check but catches truncation. */
export const looksLikeKey = (value: string): boolean =>
  value.startsWith("sk-") && value.length >= 48;

export function ApiKeyInput({
  onApiKeyChange,
  placeholder = "sk-...",
  className,
}: ApiKeyInputProps) {
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [isFocused, setIsFocused] = useState(false);

  const trimmed = apiKey.trim();
  /** null = nothing entered yet, which is a third state and not "invalid". */
  const isValid: boolean | null = trimmed ? looksLikeKey(trimmed) : null;

  useEffect(() => {
    onApiKeyChange?.(isValid ? trimmed : null);
  }, [trimmed, isValid, onApiKeyChange]);

  const clearKey = useCallback(() => {
    setApiKey("");
    setShowKey(false);
  }, []);

  const borderClass =
    isFocused
      ? "border-ring ring-ring/40 ring-2"
      : isValid === true
        ? "border-emerald-500/60"
        : isValid === false
          ? "border-destructive/60"
          : "border-input hover:border-ring/50";

  return (
    <div className={cn("w-full max-w-3xl mx-auto", className)}>
      <label
        htmlFor="openai-api-key"
        className="mb-2 flex items-center gap-2 text-sm font-medium text-muted-foreground"
      >
        <Key className="size-4" aria-hidden />
        OpenAI API key
        <span className="text-xs font-normal">(optional)</span>
      </label>

      <div
        className={cn(
          "relative rounded-lg border-2 bg-background transition-colors",
          borderClass,
        )}
      >
        <input
          id="openai-api-key"
          name="openai-api-key"
          type={showKey ? "text" : "password"}
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={isValid === false}
          aria-describedby="openai-api-key-status openai-api-key-notice"
          className="w-full rounded-lg border-0 bg-transparent px-4 py-3 pr-20 font-mono text-sm focus:outline-none focus:ring-0"
        />

        {trimmed.length > 0 && (
          <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
            <button
              type="button"
              onClick={() => setShowKey((current) => !current)}
              className="rounded p-1.5 text-muted-foreground transition-colors hover:text-foreground"
              aria-label={showKey ? "Hide API key" : "Show API key"}
            >
              {showKey ? (
                <EyeOff className="size-4" aria-hidden />
              ) : (
                <Eye className="size-4" aria-hidden />
              )}
            </button>
            <button
              type="button"
              onClick={clearKey}
              className="rounded p-1.5 text-muted-foreground transition-colors hover:text-foreground"
              aria-label="Clear API key"
            >
              <X className="size-4" aria-hidden />
            </button>
          </div>
        )}
      </div>

      <p
        id="openai-api-key-status"
        role="status"
        className="mt-2 min-h-5 text-sm"
      >
        {isValid === false && (
          <span className="text-destructive">
            That doesn&apos;t look like an OpenAI key. They begin with{" "}
            <code className="font-mono">sk-</code>.
          </span>
        )}
        {isValid === true && (
          <span className="text-emerald-600 dark:text-emerald-400">
            Key format looks right. It isn&apos;t checked against OpenAI until
            you run a generation.
          </span>
        )}
      </p>

      <div
        id="openai-api-key-notice"
        className="mt-2 flex items-start gap-2 rounded-lg border border-border bg-muted/50 p-3 text-sm"
      >
        <ShieldAlert
          className="mt-0.5 size-4 shrink-0 text-muted-foreground"
          aria-hidden
        />
        <div className="text-muted-foreground">
          <p className="mb-1 font-medium text-foreground">
            Where this key goes
          </p>
          <p>
            Your key is sent to our server and passed to the background job that
            runs the agent, where it is used to call OpenAI on your behalf. It
            is not written to our database, but it does appear in our job
            queue&apos;s event log. Leave this blank to use your account credits
            instead.
          </p>
        </div>
      </div>
    </div>
  );
}

export default ApiKeyInput;
