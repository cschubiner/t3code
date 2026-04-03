const CODEX_AUTH_ERROR_SNIPPETS = [
  "authrequired(",
  "auth required",
  "invalid_token",
  "missing or invalid access token",
  "www_authenticate",
  "not logged in",
  "login required",
  "authentication required",
  "run `codex login`",
  "run codex login",
] as const;

export function isCodexAuthErrorMessage(message: string | null | undefined): boolean {
  const normalized = message?.trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  return CODEX_AUTH_ERROR_SNIPPETS.some((snippet) => normalized.includes(snippet));
}
