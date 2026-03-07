import { defineConfig } from "eslint/config";
import { client } from "@project/eslint-config/client";

export default defineConfig([
  ...client,
  {
    ignores: [".next/"],
  },
  {
    languageOptions: {
      parserOptions: {
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
]);
