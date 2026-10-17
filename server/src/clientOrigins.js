const PRIVATE_IPV4_RANGES = [
  /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,
  /^192\.168\.\d{1,3}\.\d{1,3}$/,
  /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/
];

export function isAllowedClientOrigin(origin, configuredOrigins = []) {
  if (!origin) return true;
  if (configuredOrigins.includes(origin)) return true;

  let hostname;
  try {
    const parsed = new URL(origin);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    hostname = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  } catch {
    return false;
  }

  return hostname === "localhost"
    || hostname === "127.0.0.1"
    || hostname === "::1"
    || PRIVATE_IPV4_RANGES.some((range) => range.test(hostname));
}
