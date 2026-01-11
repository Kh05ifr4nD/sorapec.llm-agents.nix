{ pkgs, ... }:
let
  npmPackumentSupport = pkgs.callPackage ../../library/fetchNpmDependencies.nix { };
in
pkgs.callPackage ./package.nix {
  inherit (npmPackumentSupport) fetchNpmDependenciesWithPackuments npmConfigurationHook;
}
