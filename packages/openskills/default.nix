{ pkgs, flake }:
let
  npmPackumentSupport = pkgs.callPackage ../../library/fetchNpmDependencies.nix { };
in
pkgs.callPackage ./package.nix {
  inherit flake;
  inherit (npmPackumentSupport) fetchNpmDependenciesWithPackuments npmConfigurationHook;
}
