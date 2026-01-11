import {
  type CapturedOutput,
  runCapture,
  runCaptureChecked,
  runChecked,
  type RunOptions,
} from "./command.ts";

export type NixOptions = Readonly<RunOptions & { acceptFlakeConfig?: boolean }>;

function withAcceptFlakeConfig(
  argumentList: readonly string[],
  acceptFlakeConfig: boolean,
): string[] {
  return acceptFlakeConfig ? ["--accept-flake-config", ...argumentList] : [...argumentList];
}

export async function nixEvalRaw(
  attr: string,
  options: Readonly<NixOptions & { impure?: boolean }> = {},
): Promise<string> {
  const argumentList = ["eval", "--raw", ...(options.impure ? ["--impure"] : []), attr];
  const output = await runCaptureChecked(
    "nix",
    withAcceptFlakeConfig(argumentList, options.acceptFlakeConfig ?? true),
    options,
  );
  return output.stdout.trim();
}

export async function nixBuild(
  attr: string,
  options: NixOptions = {},
): Promise<void> {
  const argumentList = ["build", "--log-format", "bar-with-logs", attr];
  await runChecked(
    "nix",
    withAcceptFlakeConfig(argumentList, options.acceptFlakeConfig ?? true),
    options,
  );
}

export async function nixBuildCapture(
  attr: string,
  options: NixOptions = {},
): Promise<CapturedOutput> {
  const argumentList = ["build", "--log-format", "bar-with-logs", attr];
  return await runCapture(
    "nix",
    withAcceptFlakeConfig(argumentList, options.acceptFlakeConfig ?? true),
    options,
  );
}
