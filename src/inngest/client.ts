import { Inngest } from "inngest";
import { encryptionMiddleware } from "@inngest/middleware-encryption";

/**
 * AUDIT S1: the user's provider key travels through Inngest.
 *
 * The key goes form → tRPC input → event payload → agent function. Inngest
 * persists event payloads and renders them in its dashboard, so without
 * this middleware every user's API key is sitting in plaintext in a job
 * queue's event log, readable by anyone with access to that dashboard.
 *
 * That was acceptable-ish while the deployment had its own key and BYO was
 * a rarely-used convenience. It is not acceptable now that every user must
 * supply their own: the key is no longer an optional extra, it is the
 * credential the whole product runs on.
 *
 * `eventEncryptionField` names the top-level field to encrypt. The default
 * is `data.encrypted`, which would mean restructuring every send and every
 * read; naming `apiKey` directly leaves the event shape alone.
 *
 * Step data and function output are encrypted wholesale by default, which
 * matters here too — the key is passed into `modelFor` inside steps.
 */
const ENCRYPTION_KEY = process.env.INNGEST_ENCRYPTION_KEY;

/**
 * FAIL LOUDLY RATHER THAN DEGRADE QUIETLY.
 *
 * The tempting version of this file makes the middleware conditional:
 * encrypt when a key is configured, carry on without it when not. That
 * turns a missing environment variable into silent plaintext transmission
 * of user credentials — a security property that depends on a deploy step
 * nobody will check, and whose failure looks exactly like success.
 *
 * Refusing to start is the correct behaviour. A broken deploy is loud; a
 * leaking one is not.
 */
if (!ENCRYPTION_KEY) {
  throw new Error(
    "INNGEST_ENCRYPTION_KEY is not set.\n\n" +
      "User API keys travel through Inngest event payloads, which Inngest " +
      "persists and displays in its dashboard. Without this key they would " +
      "be stored in plaintext.\n\n" +
      "Generate one with:  openssl rand -base64 32",
  );
}

export const inngest = new Inngest({
  /**
   * Still "my-app", deliberately.
   *
   * The app id is how Inngest identifies this application and its
   * registered functions. Renaming it to "datum" registers a new app and
   * orphans the existing one — which is a fine thing to do on purpose, and
   * a bad thing to do inside a commit whose subject is encryption. It goes
   * with the rest of the rename, after a working deploy.
   */
  id: "my-app",
  middleware: [
    encryptionMiddleware({
      key: ENCRYPTION_KEY,
      eventEncryptionField: "apiKey",
    }),
  ],
});
