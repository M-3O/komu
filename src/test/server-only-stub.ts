/**
 * Stand-in for the `server-only` package under test.
 *
 * The real package throws when a server-only module is pulled into a client
 * bundle. Vitest does not build bundles, so it resolves the package's
 * default export and hits that throw. Aliasing it here keeps the guard in
 * application code while letting tests import the modules it protects.
 */

export {};