const UPSTREAM_ORIGIN = "https://techweek-2026-event-picker.0x4007.deno.net";

export default {
  async fetch(request: Request): Promise<Response> {
    const incomingUrl = new URL(request.url);
    const upstreamUrl = new URL(request.url);
    const upstreamOrigin = new URL(UPSTREAM_ORIGIN);
    upstreamUrl.protocol = upstreamOrigin.protocol;
    upstreamUrl.hostname = upstreamOrigin.hostname;
    upstreamUrl.port = upstreamOrigin.port;

    const headers = new Headers(request.headers);
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
    rewriteLocationHeader(responseHeaders, incomingUrl, upstreamOrigin);

    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers: responseHeaders,
    });
  },
};

function rewriteLocationHeader(headers: Headers, incomingUrl: URL, upstreamOrigin: URL): void {
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
  headers.set("Location", locationUrl.toString());
}
