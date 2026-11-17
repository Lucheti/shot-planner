/** Compile-time exhaustiveness guard for `switch` over discriminated unions. */
export function assertNever(value: never): never {
  throw new Error(`Unhandled variant: ${JSON.stringify(value)}`);
}
