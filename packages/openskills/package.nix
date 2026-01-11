{
  lib,
  buildNpmPackage,
  fetchFromGitHub,
  flake,
  fetchNpmDependenciesWithPackuments,
  npmConfigurationHook,
}:

buildNpmPackage (finalAttrs: {
  npmConfigHook = npmConfigurationHook;
  pname = "openskills";
  version = "1.3.0";

  src = fetchFromGitHub {
    owner = "numman-ali";
    repo = "openskills";
    rev = "v${finalAttrs.version}";
    hash = "sha256-JLPxG8PbCSRLm6DFxSSbE94pf+Ur1ME5uF5f1z2Jhjw=";
  };

  npmDeps = fetchNpmDependenciesWithPackuments {
    inherit (finalAttrs) src;
    name = "${finalAttrs.pname}-${finalAttrs.version}-npm-deps";
    hash = "sha256-53FSjHKL/DNua/otGoV1boSrqYMAQ91CrUjnGlAAiT8=";
    fetcherVersion = 2;
  };
  makeCacheWritable = true;

  passthru.category = "Utilities";

  meta = {
    description = "Universal skills loader for AI coding agents - install and load Anthropic SKILL.md format skills in any agent";
    homepage = "https://github.com/numman-ali/openskills";
    license = lib.licenses.asl20;
    sourceProvenance = with lib.sourceTypes; [ fromSource ];
    maintainers = with flake.library.maintainers; [ ypares ];
    mainProgram = "openskills";
    platforms = lib.platforms.all;
  };
})
