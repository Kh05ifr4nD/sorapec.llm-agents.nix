export type EnvironmentVariables = Readonly<Record<string, string>>;

export type RunOptions = Readonly<{
  workingDirectory?: string;
  environmentVariables?: EnvironmentVariables;
}>;

export type CapturedOutput = Readonly<{
  code: number;
  stdout: string;
  stderr: string;
}>;

export class CommandFailedError extends Error {
  readonly command: string;
  readonly argumentsList: readonly string[];
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;

  constructor(command: string, argumentsList: readonly string[], output: CapturedOutput) {
    const joinedArguments = argumentsList.map((a) => JSON.stringify(a)).join(" ");
    const message = [
      `Command failed (${output.code}): ${command} ${joinedArguments}`,
      output.stdout.trim() ? `--- stdout ---\n${output.stdout.trimEnd()}` : "",
      output.stderr.trim() ? `--- stderr ---\n${output.stderr.trimEnd()}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    super(message);
    this.name = "CommandFailedError";
    this.command = command;
    this.argumentsList = argumentsList;
    this.code = output.code;
    this.stdout = output.stdout;
    this.stderr = output.stderr;
  }
}

export function trimLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export async function runStatus(
  command: string,
  argumentsList: readonly string[],
  options: RunOptions = {},
): Promise<number> {
  const commandOptions: Deno.CommandOptions = {
    args: [...argumentsList],
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
    ...(options.environmentVariables !== undefined
      ? { env: { ...options.environmentVariables } }
      : {}),
    ...(options.workingDirectory !== undefined ? { cwd: options.workingDirectory } : {}),
  };

  const status = await new Deno.Command(command, commandOptions).spawn().status;

  return status.code;
}

export async function runChecked(
  command: string,
  argumentsList: readonly string[],
  options: RunOptions = {},
): Promise<void> {
  const code = await runStatus(command, argumentsList, options);
  if (code !== 0) {
    throw new Error(
      `Command failed (${code}): ${command} ${
        argumentsList.map((a) => JSON.stringify(a)).join(" ")
      }`,
    );
  }
}

export async function runCapture(
  command: string,
  argumentsList: readonly string[],
  options: RunOptions = {},
): Promise<CapturedOutput> {
  const commandOptions: Deno.CommandOptions = {
    args: [...argumentsList],
    stdout: "piped",
    stderr: "piped",
    ...(options.environmentVariables !== undefined
      ? { env: { ...options.environmentVariables } }
      : {}),
    ...(options.workingDirectory !== undefined ? { cwd: options.workingDirectory } : {}),
  };

  const output = await new Deno.Command(command, commandOptions).output();

  const decoder = new TextDecoder();
  return {
    code: output.code,
    stdout: decoder.decode(output.stdout),
    stderr: decoder.decode(output.stderr),
  };
}

export async function runCaptureChecked(
  command: string,
  argumentsList: readonly string[],
  options: RunOptions = {},
): Promise<CapturedOutput> {
  const output = await runCapture(command, argumentsList, options);
  if (output.code !== 0) {
    throw new CommandFailedError(command, argumentsList, output);
  }
  return output;
}
