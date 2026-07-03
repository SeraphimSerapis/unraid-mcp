import { timingSafeEqual } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

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

export async function validatePluginInstallUrl(rawUrl: string, hostAllowlist: string[]) {
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

  const addresses = isIP(parsed.hostname)
    ? [{ address: parsed.hostname }]
    : await lookup(parsed.hostname, { all: true }).catch(() => []);

  if (addresses.length === 0) {
    return `Plugin URL host ${parsed.hostname} could not be resolved.`;
  }

  for (const { address } of addresses) {
    if (isPrivateOrReservedAddress(address)) {
      return `Plugin URL host ${parsed.hostname} resolves to non-public address ${address}.`;
    }
  }

  return undefined;
}

export function looksLikeGraphqlMutation(query: string) {
  return /^\s*mutation\b/i.test(query);
}

function isPrivateOrReservedAddress(address: string) {
  if (address === "0.0.0.0" || address === "::") {
    return true;
  }

  if (address === "127.0.0.1" || address === "::1") {
    return true;
  }

  if (/^10\./.test(address) || /^192\.168\./.test(address)) {
    return true;
  }

  const octets = address.split(".").map((part) => Number(part));
  if (octets.length === 4 && octets.every((part) => Number.isInteger(part))) {
    const [a = 0, b = 0] = octets;
    return (
      a === 0 ||
      (a === 100 && b >= 64 && b <= 127) ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      a >= 224
    );
  }

  const normalized = address.toLowerCase();
  return (
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe80:") ||
    normalized.startsWith("::ffff:127.") ||
    normalized.startsWith("::ffff:10.") ||
    normalized.startsWith("::ffff:192.168.")
  );
}
