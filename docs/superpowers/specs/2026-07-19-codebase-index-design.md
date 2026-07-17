# Codebase Index — Design

## Problem
Agent runs read files repeatedly to understand a codebase. Each file read costs tokens. For a 200-file project, the agent spends 10-50K tokens just discovering structure before doing real work.

## Solution
Native Rust codebase indexer that:
1. Walks workspace files (respects .gitignore)
2. Parses JS/TS/Rust for exports, imports, symbols, routes, DB ops
3. Generates a compact MANIFEST.md (~200 bytes per file vs ~2K+ for source)
4. Provides Tauri commands for agent queries
5. Caches until workspace changes

## Token savings
| Method | Tokens for 100-file project |
|--------|---------------------------|
| Read all files | ~200K tokens |
| Read tree + grep | ~30K tokens |
| Read MANIFEST.md | ~2K tokens |
| Symbol query | ~200 tokens |

## File output format (MANIFEST.md)
```
# Codebase Index — <project>

## src/
### src/main.ts
- exports: main, App
- imports: React, ReactDOM
- deps: ./App.css

### src/api/users.ts
- exports: GET, POST, PUT, DELETE
- routes: GET /api/users, POST /api/users
- deps: ../../lib/db, ../../middleware/auth
```

## Commands
- `index_codebase(path)` → generate/refresh index, return manifest text
- `query_codebase_symbol(path, query)` → find files matching symbol/export
- `get_codebase_index(path)` → structured JSON for UI
