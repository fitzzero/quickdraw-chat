/**
 * Auto-generate API documentation from service definitions.
 * 
 * This script parses service files and extracts:
 * - Service metadata (name, ACL type)
 * - Method signatures (name, access level, payload/response types)
 * - Zod schemas (validation rules)
 * - JSDoc comments
 * 
 * Usage:
 *   pnpm tsx scripts/generate-docs.ts
 * 
 * Output:
 *   docs/api/ChatService.md
 *   docs/api/MessageService.md
 *   docs/api/UserService.md
 *   docs/api/DocumentService.md
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SERVICES_DIR = path.join(__dirname, "../apps/api/src/services");
const OUTPUT_DIR = path.join(__dirname, "../docs/api");

interface ServiceMethod {
  name: string;
  accessLevel: string;
  hasSchema: boolean;
  schemaName?: string;
  hasResolver: boolean;
  comment?: string;
}

interface ServiceInfo {
  name: string;
  className: string;
  hasEntryACL: boolean;
  aclPattern: string;
  methods: ServiceMethod[];
  schemas: Map<string, string>;
}

/**
 * Parse a service file and extract metadata
 */
function parseServiceFile(filePath: string): ServiceInfo | null {
  const content = fs.readFileSync(filePath, "utf-8");
  const fileName = path.basename(filePath);
  
  // Extract class name
  const classMatch = content.match(/export class (\w+Service)/);
  if (!classMatch) return null;
  
  const className = classMatch[1];
  const serviceName = className.charAt(0).toLowerCase() + className.slice(1);
  
  // Extract hasEntryACL
  const aclMatch = content.match(/hasEntryACL:\s*(true|false)/);
  const hasEntryACL = aclMatch ? aclMatch[1] === "true" : false;
  
  // Determine ACL pattern
  let aclPattern = "No ACL";
  if (hasEntryACL) {
    if (content.includes("override async checkEntryACL")) {
      aclPattern = "Membership table (ChatMember)";
    } else {
      aclPattern = "JSON ACL (default)";
    }
  }
  if (content.includes("override checkAccess")) {
    aclPattern = "Custom (self-access pattern)";
  }
  
  // Extract Zod schemas (improved to handle multi-line schemas)
  const schemas = new Map<string, string>();
  const schemaRegex = /const (\w+Schema) = z\.object\(\{([\s\S]*?)\}\);/g;
  let schemaMatch;
  while ((schemaMatch = schemaRegex.exec(content)) !== null) {
    // Clean up the schema content for better display
    const schemaContent = schemaMatch[2]
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .join('\n  ');
    schemas.set(schemaMatch[1], schemaContent);
  }
  
  // Extract methods
  const methods: ServiceMethod[] = [];
  const methodRegex = /this\.defineMethod\(\s*["'](\w+)["'],\s*["'](\w+)["']/g;
  let methodMatch;
  while ((methodMatch = methodRegex.exec(content)) !== null) {
    const methodName = methodMatch[1];
    const accessLevel = methodMatch[2];
    
    // Find the full defineMethod call to check for schema
    // Look for the closing of the defineMethod call (can span multiple lines)
    const methodStart = methodMatch.index;
    let parenDepth = 0;
    let methodEnd = methodStart;
    let foundStart = false;
    
    for (let i = methodStart; i < content.length; i++) {
      if (content[i] === '(') {
        parenDepth++;
        foundStart = true;
      } else if (content[i] === ')') {
        parenDepth--;
        if (foundStart && parenDepth === 0) {
          methodEnd = i;
          break;
        }
      }
    }
    
    const methodBlock = content.substring(methodStart, methodEnd + 1);
    
    const hasSchema = methodBlock.includes("schema:");
    const schemaMatch = methodBlock.match(/schema:\s*(\w+Schema)/);
    const hasResolver = methodBlock.includes("resolveEntryId:");
    
    methods.push({
      name: methodName,
      accessLevel,
      hasSchema,
      schemaName: schemaMatch ? schemaMatch[1] : undefined,
      hasResolver,
    });
  }
  
  return {
    name: serviceName,
    className,
    hasEntryACL,
    aclPattern,
    methods,
    schemas,
  };
}

/**
 * Generate markdown documentation for a service
 */
function generateServiceDoc(service: ServiceInfo): string {
  let doc = `# ${service.className}\n\n`;
  
  doc += `**Service Name:** \`${service.name}\`\n\n`;
  doc += `**Access Control:** ${service.aclPattern}\n\n`;
  
  if (service.hasEntryACL) {
    doc += `**Entry-level ACL:** Enabled\n\n`;
  }
  
  doc += `---\n\n`;
  doc += `## Methods\n\n`;
  
  for (const method of service.methods) {
    doc += `### ${method.name}\n\n`;
    doc += `- **Access Level:** \`${method.accessLevel}\`\n`;
    doc += `- **Socket Event:** \`${service.name}:${method.name}\`\n`;
    
    if (method.hasResolver) {
      doc += `- **Entry-scoped:** Yes (requires access to specific entry)\n`;
    }
    
    if (method.hasSchema && method.schemaName) {
      doc += `- **Validation:** Zod schema (\`${method.schemaName}\`)\n`;
      
      // Try to include schema details
      const schemaContent = service.schemas.get(method.schemaName);
      if (schemaContent) {
        doc += `\n**Payload Schema:**\n\n`;
        doc += `\`\`\`typescript\n`;
        doc += `{\n  ${schemaContent}\n}\n`;
        doc += `\`\`\`\n`;
      }
    } else {
      doc += `- **Validation:** None (consider adding Zod schema)\n`;
    }
    
    doc += `\n`;
  }
  
  doc += `---\n\n`;
  doc += `## Access Levels\n\n`;
  doc += `| Level | Description |\n`;
  doc += `|-------|-------------|\n`;
  doc += `| Public | No authentication required |\n`;
  doc += `| Read | Authenticated users can read |\n`;
  doc += `| Moderate | Can edit content, manage members |\n`;
  doc += `| Admin | Full control, can delete |\n\n`;
  
  doc += `---\n\n`;
  doc += `*Generated by \`scripts/generate-docs.ts\`*\n`;
  
  return doc;
}

/**
 * Main execution
 */
function main() {
  console.log("🔍 Scanning services directory...");
  
  // Create output directory
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }
  
  // Find all service directories
  const serviceDirs = fs.readdirSync(SERVICES_DIR, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name);
  
  console.log(`Found ${serviceDirs.length} services: ${serviceDirs.join(", ")}\n`);
  
  // Process each service
  for (const serviceDir of serviceDirs) {
    const indexPath = path.join(SERVICES_DIR, serviceDir, "index.ts");
    
    if (!fs.existsSync(indexPath)) {
      console.log(`⚠️  Skipping ${serviceDir} (no index.ts found)`);
      continue;
    }
    
    console.log(`📝 Processing ${serviceDir}...`);
    
    const serviceInfo = parseServiceFile(indexPath);
    if (!serviceInfo) {
      console.log(`   ❌ Failed to parse service`);
      continue;
    }
    
    const doc = generateServiceDoc(serviceInfo);
    const outputPath = path.join(OUTPUT_DIR, `${serviceInfo.className}.md`);
    
    fs.writeFileSync(outputPath, doc);
    console.log(`   ✅ Generated ${path.relative(process.cwd(), outputPath)}`);
    console.log(`   📊 ${serviceInfo.methods.length} methods documented`);
  }
  
  // Generate index file
  const indexContent = `# API Documentation\n\n` +
    `Auto-generated documentation for all services.\n\n` +
    `## Services\n\n` +
    serviceDirs.map(dir => {
      const className = dir.charAt(0).toUpperCase() + dir.slice(1) + "Service";
      return `- [${className}](./${className}.md)`;
    }).join("\n") +
    `\n\n---\n\n*Generated by \`scripts/generate-docs.ts\`*\n`;
  
  fs.writeFileSync(path.join(OUTPUT_DIR, "README.md"), indexContent);
  
  console.log(`\n✨ Documentation generated successfully!`);
  console.log(`📁 Output: ${path.relative(process.cwd(), OUTPUT_DIR)}`);
}

main();
