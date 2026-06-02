export type AuthClientConfig = {
  clientId: string;
  name: string;
  audiences: string[];
  origins: string[];
  redirectUris: string[];
};

export type AuthHubConfig = {
  issuer: string;
  rpId: string;
  rpName: string;
  challengeTtlMs: number;
  hubTokenTtlMs: number;
  accessTokenTtlMs: number;
  accessTokenMaxTtlMs: number;
  authCodeTtlMs: number;
  agentTokenDefaultTtlMs: number;
  agentTokenMaxTtlMs: number;
  clients: AuthClientConfig[];
};

const minutes = (value: number) => value * 60 * 1000;
const hours = (value: number) => value * 60 * 60 * 1000;
const days = (value: number) => value * 24 * 60 * 60 * 1000;

export const authConfig: AuthHubConfig = {
  issuer: "https://deno-universal-auth.0x4007.deno.net",
  rpId: "deno-universal-auth.0x4007.deno.net",
  rpName: "Deno Universal Auth",
  challengeTtlMs: minutes(5),
  hubTokenTtlMs: hours(12),
  accessTokenTtlMs: minutes(15),
  accessTokenMaxTtlMs: days(30),
  authCodeTtlMs: minutes(2),
  agentTokenDefaultTtlMs: days(7),
  agentTokenMaxTtlMs: days(30),
  clients: [
    {
      clientId: "techweek-2026-event-picker",
      name: "Tech Week Event Picker",
      audiences: ["techweek-2026-event-picker"],
      origins: [
        "http://localhost:8788",
        "http://127.0.0.1:8788",
        "http://m1.local:8788",
        "https://techweek.pavlovcik.com"
      ],
      redirectUris: [
        "http://localhost:8788/auth.html",
        "http://127.0.0.1:8788/auth.html",
        "http://m1.local:8788/auth.html",
        "https://techweek.pavlovcik.com/auth.html",
        "http://localhost:8788/auth/callback",
        "http://127.0.0.1:8788/auth/callback",
        "http://m1.local:8788/auth/callback",
        "https://techweek.pavlovcik.com/auth/callback"
      ]
    },
    {
      clientId: "selling-assets-korea",
      name: "Selling Assets Korea",
      audiences: ["selling-assets-korea"],
      origins: [
        "http://localhost:8001",
        "http://127.0.0.1:8001",
        "https://sell.pavlovcik.com"
      ],
      redirectUris: [
        "http://localhost:8001/auth/callback",
        "http://127.0.0.1:8001/auth/callback",
        "https://sell.pavlovcik.com/auth/callback"
      ]
    },
    {
      clientId: "uos-ai",
      name: "UOS AI",
      audiences: ["uos-ai"],
      origins: ["https://ai.ubq.fi"],
      redirectUris: ["https://ai.ubq.fi/auth/callback"]
    }
  ]
};

export const findClient = (clientId: string) =>
  authConfig.clients.find((client) => client.clientId === clientId) ?? null;

export const clientAllowsAudience = (
  client: AuthClientConfig,
  audience: string
) => client.audiences.includes(audience);

export const clientAllowsOrigin = (client: AuthClientConfig, origin: string) =>
  client.origins.includes(origin);

export const clientAllowsRedirectUri = (
  client: AuthClientConfig,
  redirectUri: string
) => client.redirectUris.includes(redirectUri);
