// Minimal ambient types for the node test runner in this package. The
// console has no @types/node (the pnpm store is read-only, so no new package
// can be added); at runtime the real node:test and node:assert run.
declare module 'node:test' {
  export function test(name: string, fn: () => void | Promise<void>): void;
}
declare module 'node:assert/strict' {
  const assert: {
    equal(a: unknown, b: unknown, msg?: string): void;
    deepEqual(a: unknown, b: unknown, msg?: string): void;
    ok(v: unknown, msg?: string): void;
    match(s: string, r: RegExp, msg?: string): void;
  };
  export default assert;
}
