/** @type {import('eslint').Linter.Config} */
module.exports = {
  extends: ["./base.js"],
  env: {
    node: true,
    es2022: true,
  },
  plugins: ["quickdraw"],
  rules: {
    // Quickdraw architectural boundary rules
    "quickdraw/no-direct-prisma-mutations": "warn",
    "quickdraw/require-zod-schema": "warn",
    "quickdraw/no-service-method-record": "error",
    "quickdraw/no-unsafe-payload-cast": "warn",
    // Server-specific rules
    // Allow console for server logging (we use Winston but console is okay for quick debugging)
    "no-console": "warn",

    // Ensure async errors are handled properly in Express/Socket.io middleware
    "@typescript-eslint/no-misused-promises": [
      "error",
      {
        checksVoidReturn: {
          arguments: false, // Allow async handlers
        },
      },
    ],

    // Server code often needs to handle unknown data from external sources
    // Prisma's dynamic types cause many false positives with these rules
    "@typescript-eslint/no-unsafe-assignment": "warn",
    "@typescript-eslint/no-unsafe-member-access": "warn",
    "@typescript-eslint/no-unsafe-call": "warn",
    "@typescript-eslint/no-unsafe-return": "warn",
    "@typescript-eslint/no-unsafe-argument": "warn",
    "@typescript-eslint/no-redundant-type-constituents": "off",
    "@typescript-eslint/no-unnecessary-type-assertion": "off",
  },
};
