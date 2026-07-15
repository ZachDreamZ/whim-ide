export const PROVIDER_ENVIRONMENT_VARIABLES: Readonly<Record<string, readonly string[]>> = {
  openai: ["OPENAI_API_KEY"],
  anthropic: ["ANTHROPIC_API_KEY"],
  google: ["GOOGLE_API_KEY", "GEMINI_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY"],
  deepseek: ["DEEPSEEK_API_KEY"],
  qwen: ["DASHSCOPE_API_KEY"],
  xiaomi: ["XIAOMI_API_KEY"],
  omniroute: ["OMNIROUTE_API_KEY"],
};

export function providerHasEnvironmentCredential(provider: string, names: readonly string[]) {
  const expected = PROVIDER_ENVIRONMENT_VARIABLES[provider] ?? [];
  if (!expected.length || !names.length) return false;
  const available = new Set(names.map((name) => name.toUpperCase()));
  return expected.some((name) => available.has(name));
}
