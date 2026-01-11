{ pkgs }:
let
  npmPackumentSupport = pkgs.callPackage ../../library/fetchNpmDependencies.nix { };
in
pkgs.callPackage ./package.nix {
  darwinOpenptyHook = pkgs.callPackage ../darwinOpenptyHook { };
  inherit (npmPackumentSupport) fetchNpmDependenciesWithPackuments npmConfigurationHook;
}
