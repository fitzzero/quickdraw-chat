/** @type {import('eslint').Linter.Config} */
module.exports = {
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/strict-type-checked",
    "plugin:@typescript-eslint/stylistic-type-checked",
  ],
  parser: "@typescript-eslint/parser",
  parserOptions: {
    projectService: true,
  },
  plugins: ["@typescript-eslint"],
  rules: {
    // =========================================================================
    // Type Safety - Catch errors early
    // =========================================================================
    "@typescript-eslint/no-explicit-any": "error",
    "@typescript-eslint/no-unsafe-assignment": "error",
    "@typescript-eslint/no-unsafe-call": "error",
    "@typescript-eslint/no-unsafe-member-access": "error",
    "@typescript-eslint/no-unsafe-return": "error",
    "@typescript-eslint/no-unsafe-argument": "error",

    // Promise handling
    "@typescript-eslint/no-floating-promises": "error",
    "@typescript-eslint/no-misused-promises": "error",
    "@typescript-eslint/await-thenable": "error",
    "@typescript-eslint/require-await": "error",

    // Unused code
    "@typescript-eslint/no-unused-vars": [
      "error",
      {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_",
      },
    ],

    // =========================================================================
    // Consistency
    // =========================================================================
    "@typescript-eslint/consistent-type-imports": [
      "error",
      { prefer: "type-imports", fixStyle: "inline-type-imports" },
    ],
    "@typescript-eslint/consistent-type-exports": [
      "error",
      { fixMixedExportsWithInlineTypeSpecifier: true },
    ],
    "@typescript-eslint/explicit-function-return-type": [
      "warn",
      {
        allowExpressions: true,
        allowTypedFunctionExpressions: true,
        allowHigherOrderFunctions: true,
        allowDirectConstAssertionInArrowFunctions: true,
      },
    ],

    // Naming conventions
    "@typescript-eslint/naming-convention": [
      "warn",
      {
        selector: "interface",
        format: ["PascalCase"],
      },
      {
        selector: "typeAlias",
        format: ["PascalCase"],
      },
    ],

    // =========================================================================
    // Ban problematic patterns (from farseer learnings)
    // =========================================================================
    "no-restricted-syntax": [
      "error",
      {
        selector:
          'TSAsExpression[typeAnnotation.typeName.name="unknown"] > TSAsExpression',
        message:
          'Avoid double `as unknown as` casts. Use proper generics, type guards, or extend the type system.',
      },
    ],

    // =========================================================================
    // Code quality
    // =========================================================================
    "no-console": "warn",
    eqeqeq: ["error", "always", { null: "ignore" }],
    "no-duplicate-imports": "error",
    "prefer-const": "error",
    "no-var": "error",

    // =========================================================================
    // Relaxed rules for pragmatism
    // =========================================================================
    "@typescript-eslint/no-non-null-assertion": "warn", // Sometimes needed
    "@typescript-eslint/restrict-template-expressions": "off", // Too strict
    "@typescript-eslint/no-unnecessary-condition": "off", // False positives
  },
  ignorePatterns: ["dist", "node_modules", "*.js", "*.mjs", "*.cjs"],
};
