import { runPartifulAutoSync, startServer } from "./server.ts";

Deno.cron("partiful-auto-sync", "* * * * *", async () => {
  await runPartifulAutoSync();
});

startServer();
