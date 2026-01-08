/** @type {import('eslint').Linter.Config} */
module.exports = {
  root: true,
  extends: ["@project/eslint-config/client"],
  parserOptions: {
    project: "./tsconfig.json",
    tsconfigRootDir: __dirname,
  },
};
