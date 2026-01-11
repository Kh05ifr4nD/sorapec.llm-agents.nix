{ pkgs, ... }:
pkgs.callPackage ./package.nix {
  versionCheckHomeHook = pkgs.callPackage ../versionCheckHomeHook { };
}
