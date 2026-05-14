const UPSTREAM_ORIGIN = "https://techweek-2026-event-picker.0x4007.deno.net";
const AGENT_ORIGIN = "https://agent.pavlovcik.com";
const AGENT_PROXY_PREFIX = "/__pi-agent";

export default {
  fetch(request: Request): Promise<Response> {
    const incomingUrl = new URL(request.url);
    if (
      incomingUrl.pathname === AGENT_PROXY_PREFIX ||
      incomingUrl.pathname.startsWith(`${AGENT_PROXY_PREFIX}/`)
    ) {
      return proxyRequest(request, incomingUrl, new URL(AGENT_ORIGIN), AGENT_PROXY_PREFIX);
    }
    return proxyRequest(request, incomingUrl, new URL(UPSTREAM_ORIGIN), "");
  },
};

async function proxyRequest(
  request: Request,
  incomingUrl: URL,
  upstreamOrigin: URL,
  stripPrefix: string,
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
  headers.set("X-Forwarded-Host", incomingUrl.host);
  headers.set("X-Forwarded-Proto", incomingUrl.protocol.replace(":", ""));
  headers.set("X-Techweek-Same-Site-Proxy", "1");

  const proxiedRequest = new Request(upstreamUrl.toString(), {
    method: request.method,
    headers,
    body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
    redirect: "manual",
  });

  const upstreamResponse = await fetch(proxiedRequest);
  const responseHeaders = new Headers(upstreamResponse.headers);
  rewriteLocationHeader(responseHeaders, incomingUrl, upstreamOrigin, stripPrefix);

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
