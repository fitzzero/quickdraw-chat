/** @type {import('eslint').Linter.Config} */
module.exports = {
  extends: ["./base.js"],
  env: {
    es2022: true,
  },
  rules: {
    // Shared code should be the strictest
    // Keep all base rules as errors

    // Ensure shared code is well-documented
    "@typescript-eslint/explicit-function-return-type": "error",
    "@typescript-eslint/explicit-module-boundary-types": "error",

    // No console in shared code - it should be library-like
    "no-console": "error",
  },
};
