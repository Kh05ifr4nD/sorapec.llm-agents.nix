{ pkgs, ... }:
pkgs.callPackage ./package.nix {
  wrapBuddy = pkgs.callPackage ../wrapBuddy { };
  versionCheckHomeHook = pkgs.callPackage ../versionCheckHomeHook { };
}
