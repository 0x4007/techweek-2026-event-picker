import { PARTIFUL_AUTO_SYNC_CRON_EXPRESSION, runPartifulAutoSync, startServer } from "./server.ts";

Deno.cron("partiful-auto-sync", PARTIFUL_AUTO_SYNC_CRON_EXPRESSION, () => {
  void runPartifulAutoSync();
});

startServer();
