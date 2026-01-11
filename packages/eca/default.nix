{ pkgs, ... }:
import ./package.nix {
  inherit pkgs;
  wrapBuddy = pkgs.callPackage ../wrapBuddy { };
  versionCheckHomeHook = pkgs.callPackage ../versionCheckHomeHook { };
}
