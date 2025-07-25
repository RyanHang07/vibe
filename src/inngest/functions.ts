import { inngest } from "./client";

export const helloWorld = inngest.createFunction(
  { id: "hello-world" },
  { event: "test/hello.world" },
  async ({ event, step }) => {
    // imagine this is a download step
    await step.sleep("wait-a-moment", "30s");
    // imagine this is a transcript step
    await step.sleep("wait-a-moment", "30s");
    // imagine this is a summary
    await step.sleep("wait-a-moment", "5s");

    return { message: `Hello ${event.data.email}!` };
  },
);