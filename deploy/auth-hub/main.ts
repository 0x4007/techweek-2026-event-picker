import { handler } from "./src/handler.ts";

export { handler } from "./src/handler.ts";

if (import.meta.main) {
  Deno.serve({ port: 8000 }, handler);
}
