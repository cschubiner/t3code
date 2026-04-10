const STRIPPED_CODEX_ENV_KEYS = ["OPENAI_ORGANIZATION"] as const;

export function buildCodexProcessEnv(input?: {
  readonly baseEnv?: NodeJS.ProcessEnv;
  readonly homePath?: string | undefined;
}): NodeJS.ProcessEnv {
  const env = { ...(input?.baseEnv ?? process.env) };

  for (const key of STRIPPED_CODEX_ENV_KEYS) {
    delete env[key];
  }

  if (input?.homePath) {
    env.CODEX_HOME = input.homePath;
  }

  return env;
}

export function getCodexApiKeyEnvironmentNotice(input?: {
  readonly authType?: string | null | undefined;
  readonly baseEnv?: NodeJS.ProcessEnv;
}): string | undefined {
  if (input?.authType !== "apiKey") {
    return undefined;
  }

  const organization = input?.baseEnv?.OPENAI_ORGANIZATION ?? process.env.OPENAI_ORGANIZATION;
  if (!organization || organization.trim().length === 0) {
    return undefined;
  }

  return "Parent env includes OPENAI_ORGANIZATION. T3 Code ignores it for Codex because it can break OpenAI API key runtime requests in other Codex flows.";
}
