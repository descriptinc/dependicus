// Concurrency limit for processInParallel — kept low to avoid hammering the
// npm registry or spawning too many child processes at once.
export const WORKER_COUNT = 4;

// maxBuffer limits for execSync calls. Node defaults to 1MB, which isn't
// enough for commands like `pnpm -r list --json` or `pnpm view --json`.
export const BUFFER_SIZES = {
    SMALL: 10 * 1024 * 1024, // 10MB — bounded output (pnpm list, pnpm install --resolution-only)
    LARGE: 50 * 1024 * 1024, // 50MB — registry queries, pnpm why
} as const;
