function toHttpOrigin(value: string): string {
  const httpUrl = value.replace(/^wss:/, "https:").replace(/^ws:/, "http:");
  try {
    return new URL(httpUrl).origin;
  } catch {
    return httpUrl;
  }
}

export function getServerHttpOrigin(): string {
  const bridgeUrl = window.desktopBridge?.getWsUrl();
  const envUrl = import.meta.env.VITE_WS_URL as string | undefined;

  if (bridgeUrl && bridgeUrl.length > 0) {
    return toHttpOrigin(bridgeUrl);
  }

  if (envUrl && envUrl.length > 0) {
    return toHttpOrigin(envUrl);
  }

  if (window.location.origin !== "null") {
    return window.location.origin;
  }

  return "";
}
