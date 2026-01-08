/** @type {import('eslint').Linter.Config} */
module.exports = {
  extends: [
    "./base.js",
    "plugin:react/recommended",
    "plugin:react-hooks/recommended",
    "next/core-web-vitals",
  ],
  env: {
    browser: true,
    es2022: true,
  },
  settings: {
    react: {
      version: "detect",
    },
  },
  rules: {
    // React specific
    "react/react-in-jsx-scope": "off", // Next.js doesn't need React import
    "react/prop-types": "off", // Using TypeScript for prop validation

    // React hooks - catch stale closures and dependency issues
    "react-hooks/exhaustive-deps": "error",
    "react-hooks/rules-of-hooks": "error",

    // Next.js specific
    "@next/next/no-img-element": "warn", // Prefer next/image but don't error

    // Client code often has event handlers that don't need return types
    "@typescript-eslint/explicit-function-return-type": "off",

    // Allow inline styles for MUI sx prop
    "react/no-unknown-property": "off",
  },
};
