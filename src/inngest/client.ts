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
   * Renamed from "my-app", which was the tutorial's placeholder.
   *
   * THIS REGISTERS A NEW APP IN INNGEST.
   *
   * The app id identifies the application and its functions. Changing it
   * does not rename the existing app — it creates a second one and orphans
   * the first, along with its run history and any in-flight events queued
   * against it.
   *
   * Which is why it waited. It was deliberately left out of the encryption
   * commit and out of the user-facing rename: a change that alters what
   * Inngest considers "the app" should not ride along inside a change about
   * something else, where its effect would be attributed to the wrong
   * thing.
   *
   * After deploying this, the old `my-app` should be archived in the
   * Inngest dashboard. Leaving it registered means a dashboard listing two
   * apps where one is dead, which is the kind of ambiguity that costs
   * someone twenty minutes at exactly the wrong moment.
   */
  id: "datum",
  middleware: [
    encryptionMiddleware({
      key: ENCRYPTION_KEY,
      eventEncryptionField: "apiKey",
    }),
  ],
});
