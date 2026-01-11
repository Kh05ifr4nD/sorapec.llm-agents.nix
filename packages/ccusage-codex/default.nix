{
  pkgs,
  flake,
  ...
}:
pkgs.callPackage ./package.nix {
  inherit flake;
  versionCheckHomeHook = pkgs.callPackage ../versionCheckHomeHook { };
}
