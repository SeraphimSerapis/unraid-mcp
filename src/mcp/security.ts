import { timingSafeEqual } from "node:crypto";

export function isAuthorizedBearer(authorization: string | undefined, expectedToken?: string) {
  if (!expectedToken) {
    return true;
  }

  const prefix = "Bearer ";
  if (!authorization?.startsWith(prefix)) {
    return false;
  }

  const provided = authorization.slice(prefix.length);
  const expectedBytes = Buffer.from(expectedToken);
  const providedBytes = Buffer.from(provided);

  if (providedBytes.length !== expectedBytes.length) {
    return false;
  }

  return timingSafeEqual(providedBytes, expectedBytes);
}

export function validatePluginInstallUrl(rawUrl: string, hostAllowlist: string[]) {
  let parsed: URL;

  try {
    parsed = new URL(rawUrl);
  } catch {
    return "Plugin URL must be a valid URL.";
  }

  if (parsed.protocol !== "https:") {
    return "Plugin URL must use https.";
  }

  if (!parsed.pathname.toLowerCase().endsWith(".plg")) {
    return "Plugin URL path must end in .plg.";
  }

  if (parsed.username || parsed.password) {
    return "Plugin URL must not contain credentials.";
  }

  if (hostAllowlist.length > 0 && !hostAllowlist.includes(parsed.hostname.toLowerCase())) {
    return `Plugin URL host ${parsed.hostname} is not in UNRAID_PLUGIN_HOST_ALLOWLIST.`;
  }

  return undefined;
}

export function looksLikeGraphqlMutation(query: string) {
  return /^\s*mutation\b/i.test(query);
}
