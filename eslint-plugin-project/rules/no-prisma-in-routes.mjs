const PRISMA_METHODS = new Set([
  "findUnique",
  "findUniqueOrThrow",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "create",
  "createMany",
  "update",
  "updateMany",
  "upsert",
  "delete",
  "deleteMany",
  "count",
  "aggregate",
  "groupBy",
]);

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow direct Prisma calls in route handlers. Move database access to service methods.",
    },
    messages: {
      noPrismaInRoutes:
        "Direct Prisma call 'prisma.{{model}}.{{method}}' in route handler violates layer separation. Move database access to a service method.",
    },
    schema: [],
  },
  create(context) {
    const filename = context.filename;
    if (!filename.endsWith("routes.ts") && !filename.endsWith("routes.js")) {
      return {};
    }

    return {
      MemberExpression(node) {
        // Match prisma.<model>.<method>() patterns
        if (
          node.object.type === "MemberExpression" &&
          node.object.object.type === "Identifier" &&
          node.object.object.name === "prisma" &&
          node.property.type === "Identifier" &&
          PRISMA_METHODS.has(node.property.name)
        ) {
          const model =
            node.object.property.type === "Identifier" ? node.object.property.name : "unknown";

          context.report({
            node,
            messageId: "noPrismaInRoutes",
            data: { model, method: node.property.name },
          });
        }
      },
    };
  },
};
