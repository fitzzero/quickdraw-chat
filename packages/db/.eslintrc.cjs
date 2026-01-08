/** @type {import('eslint').Linter.Config} */
module.exports = {
  root: true,
  extends: ["@project/eslint-config/shared"],
  parserOptions: {
    project: "./tsconfig.json",
    tsconfigRootDir: __dirname,
  },
};
