/** @type {import('eslint').ESLint.Plugin} */
module.exports = {
  rules: {
    "no-direct-prisma-mutations": {
      meta: {
        type: "problem",
        docs: {
          description:
            "Disallow direct Prisma create/update/delete in service methods. Use this.create(), this.update(), this.delete() instead.",
        },
        messages: {
          noDirectMutation:
            "Use this.{{ method }}() from BaseService instead of this.prisma.{{ model }}.{{ method }}(). " +
            "BaseService methods auto-emit updates to subscribers.",
        },
        schema: [],
      },
      create(context) {
        const MUTATION_METHODS = new Set(["create", "update", "delete"]);
        return {
          CallExpression(node) {
            const callee = node.callee;
            if (callee.type !== "MemberExpression") return;
            if (callee.property.type !== "Identifier") return;
            const methodName = callee.property.name;
            if (!MUTATION_METHODS.has(methodName)) return;
            const obj = callee.object;
            if (obj.type !== "MemberExpression") return;
            const parentObj = obj.object;
            if (parentObj.type !== "MemberExpression") return;
            if (parentObj.property.type !== "Identifier") return;
            if (parentObj.property.name !== "prisma") return;
            if (parentObj.object.type !== "ThisExpression") return;
            const modelName = obj.property.type === "Identifier" ? obj.property.name : "model";
            context.report({ node, messageId: "noDirectMutation", data: { method: methodName, model: modelName } });
          },
        };
      },
    },
    "require-zod-schema": {
      meta: {
        type: "suggestion",
        docs: {
          description: "Warn when defineMethod() is called without a Zod schema option.",
        },
        messages: {
          missingSchema:
            "defineMethod('{{ methodName }}') is missing a Zod schema. Add { schema: mySchema } as the 4th argument.",
        },
        schema: [],
      },
      create(context) {
        return {
          CallExpression(node) {
            const callee = node.callee;
            if (callee.type !== "MemberExpression") return;
            if (callee.property.type !== "Identifier") return;
            if (callee.property.name !== "defineMethod") return;
            if (callee.object.type !== "ThisExpression") return;
            const methodNameArg = node.arguments[0];
            const methodName = methodNameArg?.type === "Literal" ? String(methodNameArg.value) : "unknown";
            const optionsArg = node.arguments[3];
            if (!optionsArg) {
              context.report({ node, messageId: "missingSchema", data: { methodName } });
              return;
            }
            if (optionsArg.type === "ObjectExpression") {
              const hasSchema = optionsArg.properties.some(
                (p) => p.type === "Property" && p.key.type === "Identifier" && p.key.name === "schema"
              );
              if (!hasSchema) {
                context.report({ node, messageId: "missingSchema", data: { methodName } });
              }
            }
          },
        };
      },
    },
    "no-service-method-record": {
      meta: {
        type: "problem",
        docs: {
          description: "Disallow & ServiceMethodsRecord intersection on BaseService generics.",
        },
        messages: {
          noServiceMethodRecord:
            "Remove '& ServiceMethodsRecord' from BaseService generic. Use the concrete service methods type directly.",
        },
        schema: [],
      },
      create(context) {
        return {
          TSIntersectionType(node) {
            for (const member of node.types) {
              if (
                member.type === "TSTypeReference" &&
                member.typeName?.type === "Identifier" &&
                member.typeName.name === "ServiceMethodsRecord"
              ) {
                context.report({ node: member, messageId: "noServiceMethodRecord" });
              }
            }
          },
        };
      },
    },
    "no-unsafe-payload-cast": {
      meta: {
        type: "suggestion",
        docs: {
          description: "Warn on 'as z.infer<typeof ...>' casts in service handlers.",
        },
        messages: {
          noUnsafePayloadCast:
            "Avoid casting payload with 'as z.infer<typeof ...>'. The payload should be typed through defineMethod.",
        },
        schema: [],
      },
      create(context) {
        return {
          TSAsExpression(node) {
            const typeAnnotation = node.typeAnnotation;
            if (typeAnnotation.type !== "TSTypeReference") return;
            if (typeAnnotation.typeName?.type !== "TSQualifiedName") return;
            const left = typeAnnotation.typeName.left;
            const right = typeAnnotation.typeName.right;
            if (left.type === "Identifier" && left.name === "z" && right.type === "Identifier" && right.name === "infer") {
              context.report({ node, messageId: "noUnsafePayloadCast" });
            }
          },
        };
      },
    },
  },
};
