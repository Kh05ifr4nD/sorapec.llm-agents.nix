import { join } from "node:path";

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await Deno.stat(filePath);
    return true;
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return false;
    throw err;
  }
}

export async function ensureDirectory(directoryPath: string): Promise<void> {
  await Deno.mkdir(directoryPath, { recursive: true });
}

export async function copyDirectory(
  sourceDirectoryPath: string,
  destinationDirectoryPath: string,
): Promise<void> {
  await ensureDirectory(destinationDirectoryPath);

  for await (const entry of Deno.readDir(sourceDirectoryPath)) {
    const sourcePath = join(sourceDirectoryPath, entry.name);
    const destinationPath = join(destinationDirectoryPath, entry.name);

    if (entry.isDirectory) {
      await copyDirectory(sourcePath, destinationPath);
      continue;
    }

    if (entry.isSymlink) {
      const linkTargetPath = await Deno.readLink(sourcePath);
      await Deno.symlink(linkTargetPath, destinationPath);
      continue;
    }

    if (entry.isFile) {
      await Deno.copyFile(sourcePath, destinationPath);
      continue;
    }

    throw new Error(`copyDirectory: unsupported entry: ${sourcePath}`);
  }
}
