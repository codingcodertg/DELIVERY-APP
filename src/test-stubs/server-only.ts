// `server-only` throws by design when resolved outside a server bundle, which is exactly what
// happens under vitest's node environment. Aliasing it here lets server-only modules be unit-tested
// without weakening the guarantee in the real build, where this alias does not apply.
export {};
