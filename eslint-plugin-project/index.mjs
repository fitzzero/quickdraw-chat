import noPrismaInRoutes from "./rules/no-prisma-in-routes.mjs";

/** @type {import('eslint').ESLint.Plugin} */
export default {
  rules: {
    "no-prisma-in-routes": noPrismaInRoutes,
  },
};
