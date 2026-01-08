/** @type {import('eslint').Linter.Config} */
module.exports = {
  extends: ["./base.js"],
  env: {
    node: true,
    es2022: true,
  },
  rules: {
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
    "@typescript-eslint/no-unsafe-assignment": "warn",
    "@typescript-eslint/no-unsafe-member-access": "warn",
  },
};
