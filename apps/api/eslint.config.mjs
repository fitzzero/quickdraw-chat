import { defineConfig } from "eslint/config";
import { server } from "@project/eslint-config/server";

export default defineConfig([
  ...server,
  {
    languageOptions: {
      parserOptions: {
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
]);
