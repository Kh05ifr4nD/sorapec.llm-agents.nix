{
  pkgs,
  ...
}:
let
  npmPackumentSupport = pkgs.callPackage ../../library/fetchNpmDependencies.nix { };
in
pkgs.callPackage ./package.nix {
  versionCheckHomeHook = pkgs.callPackage ../versionCheckHomeHook { };
  inherit (npmPackumentSupport) fetchNpmDependenciesWithPackuments npmConfigurationHook;
}
