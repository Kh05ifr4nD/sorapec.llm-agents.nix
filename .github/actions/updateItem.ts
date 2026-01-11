import { assertArray, assertRecord } from "../../scripts/updater/assert.ts";
import {
  type EnvironmentVariables,
  runCapture,
  runCaptureChecked,
  runChecked,
  runStatus,
  trimLines,
} from "../../scripts/updater/command.ts";
import { fileExists } from "../../scripts/updater/fileSystem.ts";
import { updateReadme } from "../../scripts/generatePackageDocumentation.ts";

type UpdateType = "package" | "flake-input";

function getEnvironmentVariable(name: string, fallback = ""): string {
  return Deno.env.get(name) ?? fallback;
}

function hasEnvironmentVariable(name: string): boolean {
  return Deno.env.has(name);
}

async function readSmokePackages(): Promise<string> {
  if (hasEnvironmentVariable("SMOKE_PACKAGES")) {
    return getEnvironmentVariable("SMOKE_PACKAGES");
  }

  const file = ".github/smokePackages.txt";
  if (!(await fileExists(file))) return "";

  const content = await Deno.readTextFile(file);
  return content
    .split(/\r?\n/)
    .map((line) => line.replace(/#.*$/, "").trim())
    .filter(Boolean)
    .join(" ");
}

function splitLabels(labels: string): string[] {
  return labels
    .split(",")
    .map((label) => label.trim())
    .filter(Boolean);
}

async function gitPorcelain(environmentVariables: EnvironmentVariables): Promise<string> {
  const result = await runCaptureChecked("git", ["status", "--porcelain"], {
    environmentVariables,
  });
  return result.stdout;
}

async function nixEvalPackageVersion(
  name: string,
  system: string,
  environmentVariables: EnvironmentVariables,
): Promise<string> {
  const nixAttribute = `.#packages.${system}."${name}".version`;
  const result = await runCapture("nix", ["eval", "--raw", "--impure", nixAttribute], {
    environmentVariables,
  });
  if (result.code !== 0) return "unknown";
  return result.stdout.trim() || "unknown";
}

async function readFlakeInputRev(name: string): Promise<string> {
  const lockText = await Deno.readTextFile("flake.lock");
  const lockData: unknown = JSON.parse(lockText);

  assertRecord(lockData, "flake.lock: expected object");
  const nodes = lockData["nodes"];
  assertRecord(nodes, "flake.lock.nodes: expected object");

  const node = nodes[name];
  if (node === null || node === undefined) return "unknown";
  assertRecord(node, `flake.lock.nodes.${name}: expected object`);

  const locked = node["locked"];
  if (locked === null || locked === undefined) return "unknown";
  assertRecord(locked, `flake.lock.nodes.${name}.locked: expected object`);

  const rev = locked["rev"];
  if (typeof rev !== "string" || !rev) return "unknown";
  return rev.slice(0, 8);
}

async function gitHubPullRequestNumberForBranch(
  branch: string,
  environmentVariables: EnvironmentVariables,
): Promise<number | null> {
  const result = await runCaptureChecked(
    "gh",
    ["pr", "list", "--head", branch, "--json", "number"],
    {
      environmentVariables,
    },
  );

  const parsed: unknown = JSON.parse(result.stdout);
  assertArray(parsed, "gh pr list: expected array");
  if (parsed.length === 0) return null;

  const first = parsed[0];
  assertRecord(first, "gh pr list[0]: expected object");
  const number = first["number"];
  return typeof number === "number" ? number : null;
}

async function main(): Promise<void> {
  const [typeArgument, name, currentVersion] = Deno.args;
  if (!typeArgument || !name || !currentVersion) {
    throw new Error("Usage: updateItem.ts <package|flake-input> <name> <currentVersion>");
  }
  const type = typeArgument as UpdateType;
  if (type !== "package" && type !== "flake-input") {
    throw new Error(`Unknown type '${typeArgument}' (expected 'package' or 'flake-input')`);
  }

  const system = getEnvironmentVariable("SYSTEM", "x86_64-linux");
  const pullRequestLabels = getEnvironmentVariable("PR_LABELS", "dependencies,automated");
  const autoMerge = getEnvironmentVariable("AUTO_MERGE", "false");

  const githubToken = getEnvironmentVariable("GH_TOKEN");
  if (!githubToken) {
    console.error("Error: GH_TOKEN is not set");
    Deno.exit(1);
  }

  const environmentVariables = {
    ...Deno.env.toObject(),
    NIX_PATH: "nixpkgs=flake:nixpkgs",
  };

  const status = await gitPorcelain(environmentVariables);
  if (status.trim()) {
    console.error("Error: working tree is not clean before update");
    console.error(status.trimEnd());
    Deno.exit(1);
  }

  console.log("=== Update target ===");
  console.log(`type=${type}`);
  console.log(`name=${name}`);
  console.log(`system=${system}`);
  console.log(`currentVersion=${currentVersion}`);
  console.log();

  if (type === "package") {
    const updaterPath = `packages/${name}/update.ts`;
    if (await fileExists(updaterPath)) {
      console.log(`Running ${updaterPath}`);
      await runChecked(
        "deno",
        [
          "run",
          "--config",
          "deno.jsonc",
          "--allow-run",
          "--allow-read",
          "--allow-write",
          "--allow-env",
          "--allow-net",
          updaterPath,
        ],
        { environmentVariables },
      );
    } else {
      console.log(`No update.ts for ${name}; running nix-update`);
      const argumentsFilePathCandidates = [
        `packages/${name}/nixUpdateArgs`,
        `packages/${name}/nix-update-args`,
      ];

      let additionalArguments: string[] = [];
      for (const argumentsFilePath of argumentsFilePathCandidates) {
        if (!(await fileExists(argumentsFilePath))) continue;
        additionalArguments = (await Deno.readTextFile(argumentsFilePath))
          .split(/\r?\n/)
          .map((line) => line.replace(/#.*$/, "").trim())
          .filter(Boolean);
        break;
      }

      await runChecked("nix-update", ["--flake", name, ...additionalArguments], {
        environmentVariables,
      });
    }
  } else {
    console.log(`Running nix flake update ${name}`);
    await runChecked("nix", ["flake", "update", name], { environmentVariables });
  }

  {
    const diff = await runStatus("git", ["diff", "--quiet"], { environmentVariables });
    if (diff === 0) {
      console.log("No changes detected; skipping PR.");
      return;
    }
  }

  console.log("Regenerating README package docs (if needed)...");
  await updateReadme("README.md");

  console.log("Formatting repository...");
  await runChecked("nix", ["fmt"], { environmentVariables });

  {
    const diff = await runStatus("git", ["diff", "--quiet"], { environmentVariables });
    if (diff === 0) {
      console.log("No changes detected after formatting; skipping PR.");
      return;
    }
  }

  let newVersion = "unknown";
  if (type === "package") {
    newVersion = await nixEvalPackageVersion(name, system, environmentVariables);
  } else {
    newVersion = await readFlakeInputRev(name);
  }

  console.log("=== Validation ===");
  if (type === "package") {
    await runChecked("nix", [
      "build",
      "--accept-flake-config",
      "--no-link",
      `.#checks.${system}.pkgs-${name}`,
    ], {
      environmentVariables,
    });
    await runChecked("nix", [
      "build",
      "--accept-flake-config",
      "--no-link",
      `.#checks.${system}.pkgs-formatter-check`,
    ], {
      environmentVariables,
    });
    await runChecked("nix", [
      "build",
      "--accept-flake-config",
      "--no-link",
      `.#checks.${system}.pkgs-formatter-denoCheck`,
    ], {
      environmentVariables,
    });
  } else {
    await runChecked("nix", ["flake", "check", "--no-build", "--accept-flake-config"], {
      environmentVariables,
    });
    await runChecked("nix", [
      "build",
      "--accept-flake-config",
      "--no-link",
      `.#checks.${system}.pkgs-formatter-check`,
    ], {
      environmentVariables,
    });
    await runChecked("nix", [
      "build",
      "--accept-flake-config",
      "--no-link",
      `.#checks.${system}.pkgs-formatter-denoCheck`,
    ], {
      environmentVariables,
    });

    const smokePackages = (await readSmokePackages()).trim();
    if (smokePackages) {
      console.log("=== Smoke build (flake input update) ===");
      console.log(smokePackages);
      for (const packageName of smokePackages.split(/\s+/).filter(Boolean)) {
        await runChecked("nix", [
          "build",
          "--accept-flake-config",
          "--no-link",
          `.#checks.${system}.pkgs-${packageName}`,
        ], {
          environmentVariables,
        });
      }
    }
  }

  const changedFiles = trimLines(
    (await runCapture("git", ["diff", "--name-only"], { environmentVariables })).stdout,
  );
  const untrackedFiles = trimLines(
    (await runCapture("git", ["ls-files", "--others", "--exclude-standard"], {
      environmentVariables,
    }))
      .stdout,
  );
  const allFiles = Array.from(new Set([...changedFiles, ...untrackedFiles])).sort();

  if (allFiles.length === 0) {
    console.error("Error: expected changes but working tree is clean");
    Deno.exit(1);
  }

  console.log("=== Worktree changes ===");
  console.log(allFiles.join("\n"));
  console.log();

  const isAllowedChange = (file: string): boolean => {
    if (type === "package") {
      if (file === "README.md") return true;
      return file.startsWith(`packages/${name}/`);
    }

    return file === "flake.lock" || file === "README.md";
  };

  for (const file of allFiles) {
    if (!isAllowedChange(file)) {
      console.error(`Error: unexpected change outside allowed scope: ${file}`);
      console.error(
        `Hint: package updates must only touch packages/${name}/** and optionally README.md`,
      );
      console.error(
        "Hint: flake-input updates must only touch flake.lock and optionally README.md",
      );
      Deno.exit(1);
    }
  }

  const branch = type === "package" ? `update/${name}` : `update/flake-input/${name}`;
  const pullRequestTitle = type === "package"
    ? `${name}: ${currentVersion} -> ${newVersion}`
    : `flake.lock: Update ${name}`;
  const pullRequestBody = type === "package"
    ? `Automated update of ${name} from ${currentVersion} to ${newVersion}.`
    : `This PR updates the flake input \`${name}\`.\n\n- ${name}: \`${currentVersion}\` → \`${newVersion}\``;

  console.log("=== Create/Update PR ===");
  console.log(`branch=${branch}`);
  console.log(`title=${pullRequestTitle}`);
  console.log();

  await runChecked("git", ["switch", "-C", branch], { environmentVariables });

  if (type === "package") {
    await runChecked("git", ["add", `packages/${name}`, "README.md"], { environmentVariables });
  } else {
    await runChecked("git", ["add", "flake.lock", "README.md"], { environmentVariables });
  }

  {
    const staged = await runStatus("git", ["diff", "--cached", "--quiet"], {
      environmentVariables,
    });
    if (staged === 0) {
      console.error("Error: nothing staged for commit");
      Deno.exit(1);
    }
  }

  await runChecked("git", ["commit", "-m", pullRequestTitle, "--signoff"], {
    environmentVariables,
  });
  await runChecked("git", ["push", "--force", "--set-upstream", "origin", branch], {
    environmentVariables,
  });

  const labelArguments = splitLabels(pullRequestLabels).flatMap((label) => ["--label", label]);

  let pullRequestNumber = await gitHubPullRequestNumberForBranch(branch, environmentVariables);
  if (pullRequestNumber !== null) {
    console.log(`Updating existing PR #${pullRequestNumber}`);
    await runChecked("gh", [
      "pr",
      "edit",
      String(pullRequestNumber),
      "--title",
      pullRequestTitle,
      "--body",
      pullRequestBody,
      ...labelArguments,
    ], {
      environmentVariables,
    });
  } else {
    console.log("Creating new PR");
    await runChecked("gh", [
      "pr",
      "create",
      "--title",
      pullRequestTitle,
      "--body",
      pullRequestBody,
      "--base",
      "main",
      "--head",
      branch,
      ...labelArguments,
    ], {
      environmentVariables,
    });
    pullRequestNumber = await gitHubPullRequestNumberForBranch(branch, environmentVariables);
  }

  if (autoMerge === "true" && pullRequestNumber !== null) {
    console.log(`Enabling auto-merge for PR #${pullRequestNumber}`);
    try {
      await runChecked("gh", ["pr", "merge", String(pullRequestNumber), "--auto", "--squash"], {
        environmentVariables,
      });
    } catch {
      console.log("Note: auto-merge may require branch protection rules");
    }
  }
}

if (import.meta.main) {
  try {
    await main();
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    Deno.exit(1);
  }
}
