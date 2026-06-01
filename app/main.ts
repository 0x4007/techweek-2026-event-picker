const DEFAULT_PORT = 8788;
const PORT_SCAN_ATTEMPTS = 150;
const STATIC_DIR = new URL("./static/", import.meta.url);
const STATIC_FILES = new Set([
  "/app.js",
  "/auth.html",
  "/auth.js",
  "/index.html",
  "/styles.css",
]);

type Router = (request: Request) => Promise<Response> | Response;

let routerPromise: Promise<Router> | null = null;

if (isDenoDeployRuntime()) {
  Deno.serve(handleRequest);
} else {
  Deno.serve({
    hostname: "0.0.0.0",
    port: findFreePort(resolvePreferredPort()),
    onListen,
  }, handleRequest);
}

function onListen({ hostname, port }: { hostname: string; port: number }) {
  console.log(`Tech Week app running on http://${hostname}:${port}`);
}

async function handleRequest(request: Request): Promise<Response> {
  const warmResponse = await warmStaticResponse(request);
  if (warmResponse) return warmResponse;

  const router = await lazyRouter();
  return await router(request);
}

async function lazyRouter(): Promise<Router> {
  routerPromise ??= import("./server.ts").then(({ router }) => router);
  return await routerPromise;
}

async function warmStaticResponse(request: Request): Promise<Response | null> {
  const url = new URL(request.url);
  const method = request.method;

  if (method === "GET" && url.pathname === "/api/health") {
    return json({ status: "ready" });
  }

  if (method !== "GET" && method !== "HEAD") return null;

  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  if (pathname.startsWith("/api/")) return null;
  const staticPathname = STATIC_FILES.has(pathname) ? pathname : "/index.html";

  const headers = new Headers();
  headers.set("content-type", contentType(staticPathname));
  headers.set("cache-control", cacheControl(staticPathname));
  const body = method === "HEAD"
    ? null
    : await Deno.readFile(new URL(`.${staticPathname}`, STATIC_DIR));
  return new Response(body, { headers });
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body, null, 2), {
    headers: { "content-type": "application/json" },
  });
}

function contentType(pathname: string): string {
  if (pathname.endsWith(".html")) return "text/html; charset=utf-8";
  if (pathname.endsWith(".js")) return "application/javascript; charset=utf-8";
  if (pathname.endsWith(".css")) return "text/css; charset=utf-8";
  return "application/octet-stream";
}

function cacheControl(pathname: string): string {
  if (pathname === "/index.html" || pathname === "/auth.html") return "no-store";
  return "public, max-age=60";
}

function resolvePreferredPort(): number {
  const envPort = Deno.env.get("PORT");
  const parsedPort = Number.parseInt(envPort ?? "", 10);
  if (Number.isInteger(parsedPort) && parsedPort >= 1 && parsedPort <= 65535) {
    return parsedPort;
  }
  return DEFAULT_PORT;
}

function isDenoDeployRuntime(): boolean {
  return Boolean(Deno.env.get("DENO_DEPLOY") || Deno.env.get("DENO_DEPLOYMENT_ID"));
}

function findFreePort(startPort: number): number {
  const maxPort = Math.min(65_535, startPort + PORT_SCAN_ATTEMPTS - 1);
  for (let candidate = startPort; candidate <= maxPort; candidate += 1) {
    try {
      const listener = Deno.listen({ hostname: "0.0.0.0", port: candidate });
      listener.close();
      return candidate;
    } catch (error) {
      if (error instanceof Deno.errors.AddrInUse) continue;
      throw error;
    }
  }
  throw new Error(
    `No free port available in range ${startPort}-${maxPort}. Set PORT explicitly to choose a free port.`,
  );
}
