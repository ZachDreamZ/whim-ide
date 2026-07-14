# Whim agent harness benchmark

`npm run benchmark:agents -- --provider=opencode --model=deepseek-v4-flash-free --thinking=low`

The suite measures the decision boundary Whim needs from coding models: targeted reads, search-before-read, native verification, role/capability enforcement, workspace confinement, secret refusal, destructive-action confirmation, and safe preview behavior. It runs three isolated Pi workers by default and disables ambient extensions, skills, prompt templates, context files, sessions, and built-in tools so repeated runs compare the model and prompt rather than the operator's global Pi setup.

Reports are written under `artifacts/benchmarks/` and include case-level checks, median latency, token usage returned by Pi, and reported cost. They intentionally do not retain model reasoning or raw tool output.

This is a small product-specific regression suite, not a substitute for established external benchmarks. Compare it alongside:

- [BFCL V4](https://gorilla.cs.berkeley.edu/leaderboard) for reproducible tool/function calling.
- [SWE-bench](https://github.com/SWE-bench/SWE-bench) for real GitHub issue resolution. Its full local harness is intentionally not bundled because the official setup recommends roughly 120 GB free storage, which exceeds the target machine.
- [Gemma 4 model documentation](https://deepmind.google/models/gemma/gemma-4/) for the 31B IT model's published coding and agentic results.
- [DeepSeek API documentation](https://api-docs.deepseek.com/quick_start/pricing/) for current context, tool-calling, and pricing behavior.
