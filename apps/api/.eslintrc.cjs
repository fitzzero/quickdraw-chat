/** @type {import('eslint').Linter.Config} */
module.exports = {
  root: true,
  extends: ["@project/eslint-config/server"],
  parserOptions: {
    project: "./tsconfig.json",
    tsconfigRootDir: __dirname,
  },
};
