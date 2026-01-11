{ pkgs, ... }:
pkgs.callPackage ./package.nix {
  wrapBuddy = pkgs.callPackage ../wrapBuddy { };
}
