import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { assertRecord, assertString } from "./updater/assert.ts";
import { runCaptureChecked } from "./updater/command.ts";

type PackageMetadata = Readonly<{
  description: string;
  version: string;
  license: string;
  homepage: string | null;
  sourceType: string;
  hideFromDocumentation: boolean;
  hasMainProgram: boolean;
  category: string;
}>;

const beginMarker = "<!-- BEGIN GENERATED PACKAGE DOCS -->";
const endMarker = "<!-- END GENERATED PACKAGE DOCS -->";

const categoryOrder = [
  "AI Coding Agents",
  "Codex Ecosystem",
  "Workflow & Project Management",
  "Code Review",
  "Utilities",
  "Uncategorized",
] as const;

function parsePackageMetadata(value: unknown, context: string): PackageMetadata {
  assertRecord(value, `${context}: expected object`);

  const description = value["description"];
  const version = value["version"];
  const license = value["license"];
  const homepage = value["homepage"];
  const sourceType = value["sourceType"];
  const hideFromDocumentation = value["hideFromDocumentation"];
  const hasMainProgram = value["hasMainProgram"];
  const category = value["category"];

  assertString(description, `${context}: description`);
  assertString(version, `${context}: version`);
  assertString(license, `${context}: license`);
  if (homepage !== null) assertString(homepage, `${context}: homepage`);
  assertString(sourceType, `${context}: sourceType`);
  if (typeof hideFromDocumentation !== "boolean") {
    throw new Error(`${context}: hideFromDocumentation must be a boolean`);
  }
  if (typeof hasMainProgram !== "boolean") {
    throw new Error(`${context}: hasMainProgram must be a boolean`);
  }
  assertString(category, `${context}: category`);

  return {
    description,
    version,
    license,
    homepage,
    sourceType,
    hideFromDocumentation,
    hasMainProgram,
    category,
  };
}

function parseAllPackagesMetadata(value: unknown): Record<string, PackageMetadata> {
  assertRecord(value, "nix eval output");

  const result: Record<string, PackageMetadata> = {};
  for (const [packageName, metadataOrNull] of Object.entries(value)) {
    if (metadataOrNull === null) continue;
    result[packageName] = parsePackageMetadata(metadataOrNull, `metadata[${packageName}]`);
  }

  return result;
}

export async function getFlakeRef(): Promise<string> {
  const override = Deno.env.get("PACKAGE_DOCS_FLAKE");
  if (override) return override;

  const githubRepository = Deno.env.get("GITHUB_REPOSITORY");
  if (githubRepository) return `github:${githubRepository}`;

  const output = await runCaptureChecked("git", ["remote", "get-url", "origin"]);
  const url = output.stdout.trim();

  if (!url.includes("github.com")) return ".";

  const match = url.match(/[:/]([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/);
  if (!match) return ".";

  const owner = match[1];
  const repository = match[2];
  return `github:${owner}/${repository}`;
}

export async function getAllPackagesMetadata(): Promise<Record<string, PackageMetadata>> {
  const scriptDirectory = dirname(fileURLToPath(import.meta.url));
  const nixFile = join(scriptDirectory, "generatePackageDocumentation.nix");

  const output = await runCaptureChecked("nix", [
    "--accept-flake-config",
    "eval",
    "--json",
    "--file",
    nixFile,
  ]);

  const parsed: unknown = JSON.parse(output.stdout);
  return parseAllPackagesMetadata(parsed);
}

function generatePackageDocumentationEntry(
  packageName: string,
  metadata: PackageMetadata,
  flakeRef: string,
): string {
  const lines: string[] = [];

  lines.push("<details>");
  lines.push(`<summary><strong>${packageName}</strong> - ${metadata.description}</summary>`);
  lines.push("");
  lines.push(`- **Source**: ${metadata.sourceType}`);
  lines.push(`- **License**: ${metadata.license}`);

  if (metadata.homepage) {
    lines.push(`- **Homepage**: ${metadata.homepage}`);
  }

  lines.push(`- **Usage**: \`nix run ${flakeRef}#${packageName} -- --help\``);
  lines.push(
    `- **Nix**: [packages/${packageName}/package.nix](packages/${packageName}/package.nix)`,
  );

  const packageReadme = `packages/${packageName}/README.md`;
  try {
    Deno.statSync(packageReadme);
    lines.push(
      `- **Documentation**: See [${packageReadme}](${packageReadme}) for detailed usage`,
    );
  } catch {
    // no-op
  }

  lines.push("");
  lines.push("</details>");
  return lines.join("\n");
}

function generateAllDocumentation(
  metadataByPackage: Record<string, PackageMetadata>,
  flakeRef: string,
): string {
  const byCategory = new Map<string, Array<[string, PackageMetadata]>>();

  const entries = Object.entries(metadataByPackage).sort(([a], [b]) => a.localeCompare(b));
  for (const [packageName, metadata] of entries) {
    const category = metadata.category;
    const list = byCategory.get(category) ?? [];
    list.push([packageName, metadata]);
    byCategory.set(category, list);
  }

  const documentation: string[] = [];

  const seen = new Set<string>();
  for (const category of categoryOrder) {
    const entries = byCategory.get(category);
    if (!entries) continue;
    seen.add(category);
    documentation.push(`### ${category}\n`);
    for (const [packageName, metadata] of entries) {
      documentation.push(generatePackageDocumentationEntry(packageName, metadata, flakeRef));
    }
    documentation.push("");
  }

  const remainingCategories = [...byCategory.keys()].filter((c) => !seen.has(c)).sort();
  for (const category of remainingCategories) {
    const entries = byCategory.get(category);
    if (!entries) continue;
    documentation.push(`### ${category}\n`);
    for (const [packageName, metadata] of entries) {
      documentation.push(generatePackageDocumentationEntry(packageName, metadata, flakeRef));
    }
    documentation.push("");
  }

  return documentation.join("\n").trimEnd();
}

export async function updateReadme(readmePath: string): Promise<boolean> {
  const content = await Deno.readTextFile(readmePath);

  const beginIndex = content.indexOf(beginMarker);
  const endIndex = content.indexOf(endMarker);

  if (beginIndex === -1 || endIndex === -1) {
    throw new Error(`Could not find markers in ${readmePath}`);
  }
  if (endIndex < beginIndex) {
    throw new Error(`END marker appears before BEGIN marker in ${readmePath}`);
  }

  const flakeRef = await getFlakeRef();
  const metadata = await getAllPackagesMetadata();
  const generated = generateAllDocumentation(metadata, flakeRef);

  const newContent = content.slice(0, beginIndex + beginMarker.length) +
    "\n\n" +
    generated +
    "\n" +
    content.slice(endIndex);

  if (newContent === content) return false;

  await Deno.writeTextFile(readmePath, newContent);
  return true;
}

async function main(): Promise<void> {
  const scriptDirectory = dirname(fileURLToPath(import.meta.url));
  const readmePath = join(scriptDirectory, "..", "README.md");

  const modified = await updateReadme(readmePath);
  console.log(modified ? `Updated ${readmePath}` : `No changes to ${readmePath}`);
}

if (import.meta.main) {
  await main();
}
