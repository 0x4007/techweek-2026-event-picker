const UPSTREAM_ORIGIN = "https://techweek-2026-event-picker.0x4007.deno.net";
const AGENT_ORIGIN = "https://agent.pavlovcik.com";
// Origin-only tunnel hostname; the public agent hostname is Worker-fronted.
const AGENT_BACKEND_ORIGIN = "https://agent-origin.pavlovcik.com";
const AGENT_PROXY_PREFIX = "/__pi-agent";

export default {
  fetch(request: Request): Promise<Response> {
    const incomingUrl = new URL(request.url);
    if (incomingUrl.hostname === new URL(AGENT_ORIGIN).hostname) {
      return proxyRequest(request, incomingUrl, new URL(AGENT_BACKEND_ORIGIN), "", {
        host: new URL(AGENT_ORIGIN).hostname,
        rewriteOrigin: new URL(AGENT_ORIGIN),
      });
    }
    if (
      incomingUrl.pathname === AGENT_PROXY_PREFIX ||
      incomingUrl.pathname.startsWith(`${AGENT_PROXY_PREFIX}/`)
    ) {
      return proxyRequest(
        request,
        incomingUrl,
        new URL(AGENT_BACKEND_ORIGIN),
        AGENT_PROXY_PREFIX,
        {
          host: new URL(AGENT_ORIGIN).hostname,
          rewriteOrigin: new URL(AGENT_ORIGIN),
        },
      );
    }
    return proxyRequest(request, incomingUrl, new URL(UPSTREAM_ORIGIN), "");
  },
};

async function proxyRequest(
  request: Request,
  incomingUrl: URL,
  upstreamOrigin: URL,
  stripPrefix: string,
  options: { host?: string; rewriteOrigin?: URL } = {},
): Promise<Response> {
  const upstreamUrl = new URL(request.url);
  upstreamUrl.protocol = upstreamOrigin.protocol;
  upstreamUrl.hostname = upstreamOrigin.hostname;
  upstreamUrl.port = upstreamOrigin.port;
  if (stripPrefix && upstreamUrl.pathname.startsWith(stripPrefix)) {
    upstreamUrl.pathname = upstreamUrl.pathname.slice(stripPrefix.length) || "/";
  }

  const headers = new Headers(request.headers);
  headers.delete("Host");
  if (options.host) {
    headers.set("Host", options.host);
  }
  headers.set("X-Forwarded-Host", incomingUrl.host);
  headers.set("X-Forwarded-Proto", incomingUrl.protocol.replace(":", ""));
  headers.set("X-Techweek-Same-Site-Proxy", "1");

  const requestInit: RequestInit = {
    method: request.method,
    headers,
    body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
    redirect: "manual",
  };
  const proxiedRequest = new Request(upstreamUrl.toString(), requestInit);

  const upstreamResponse = await fetch(proxiedRequest);
  const responseHeaders = new Headers(upstreamResponse.headers);
  rewriteLocationHeader(
    responseHeaders,
    incomingUrl,
    options.rewriteOrigin || upstreamOrigin,
    stripPrefix,
  );

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers: responseHeaders,
  });
}

function rewriteLocationHeader(
  headers: Headers,
  incomingUrl: URL,
  upstreamOrigin: URL,
  proxyPrefix: string,
): void {
  const location = headers.get("Location");
  if (!location) return;
  let locationUrl: URL;
  try {
    locationUrl = new URL(location, upstreamOrigin);
  } catch {
    return;
  }
  if (locationUrl.origin !== upstreamOrigin.origin) return;
  locationUrl.protocol = incomingUrl.protocol;
  locationUrl.host = incomingUrl.host;
  if (proxyPrefix) {
    locationUrl.pathname = `${proxyPrefix}${locationUrl.pathname}`;
  }
  headers.set("Location", locationUrl.toString());
}
