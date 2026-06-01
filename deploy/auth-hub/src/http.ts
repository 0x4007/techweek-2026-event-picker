import { authConfig, clientAllowsOrigin } from "./config.ts";

export const jsonResponse = (
  body: unknown,
  status = 200,
  headers: HeadersInit = {}
) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers
    }
  });

export const textResponse = (
  body: string,
  status = 200,
  headers: HeadersInit = {}
) =>
  new Response(body, {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
      ...headers
    }
  });

export const htmlResponse = (body: string, headers: HeadersInit = {}) =>
  new Response(body, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      ...headers
    }
  });

export const methodNotAllowed = () => textResponse("Method Not Allowed", 405);

export const readJson = async <T>(request: Request): Promise<T | null> => {
  try {
    return await request.json() as T;
  } catch {
    return null;
  }
};

export const errorResponse = (error: string, status = 400) =>
  jsonResponse({ error }, status);

const knownCorsOrigin = (origin: string) => {
  try {
    const normalized = new URL(origin).origin;
    if (normalized === authConfig.issuer) return normalized;
    for (const client of authConfig.clients) {
      if (clientAllowsOrigin(client, normalized)) return normalized;
    }
  } catch {
    return "";
  }
  return "";
};

export const corsHeadersForRequest = (request: Request): HeadersInit => {
  const origin = request.headers.get("origin") ?? "";
  const allowedOrigin = origin ? knownCorsOrigin(origin) : "";
  if (!allowedOrigin) return {};
  return {
    "access-control-allow-origin": allowedOrigin,
    "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
    "access-control-allow-headers": "authorization,content-type",
    "access-control-max-age": "600",
    "vary": "Origin"
  };
};

export const withCors = (request: Request, response: Response) => {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(corsHeadersForRequest(request))) {
    headers.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
};

export const optionsResponse = (request: Request) =>
  new Response(null, {
    status: 204,
    headers: corsHeadersForRequest(request)
  });
