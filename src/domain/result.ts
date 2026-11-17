/** A value or a typed error; the domain never throws for expected failures. */
export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

/** Wraps a success value. */
export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

/** Wraps a failure. */
export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}
