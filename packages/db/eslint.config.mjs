import { defineConfig } from "eslint/config";
import { shared } from "@project/eslint-config/shared";

export default defineConfig([
  ...shared,
  {
    languageOptions: {
      parserOptions: {
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
]);
