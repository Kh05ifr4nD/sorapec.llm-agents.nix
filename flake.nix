{
  description = "Nix packages for AI coding agents and development tools";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    treefmt-nix = {
      url = "github:numtide/treefmt-nix";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs =
    inputs@{
      self,
      nixpkgs,
      ...
    }:
    let
      supportedSystems = [
        "aarch64-darwin"
        "aarch64-linux"
        "x86_64-darwin"
        "x86_64-linux"
      ];

      forEachSupportedSystem = function: nixpkgs.lib.genAttrs supportedSystems (system: function system);

      packageDirectoryEntries = builtins.readDir ./packages;
      packageNames = builtins.sort builtins.lessThan (
        builtins.attrNames (
          nixpkgs.lib.filterAttrs (_name: type: type == "directory") packageDirectoryEntries
        )
      );

      makePackageSet =
        system:
        import inputs.nixpkgs {
          inherit system;
          config.allowUnfree = true;
        };

      makeUnfilteredPackages =
        system:
        let
          packageSet = makePackageSet system;
          callPackage = nixpkgs.lib.callPackageWith (
            packageSet
            // {
              pkgs = packageSet;
              inherit inputs;
              flake = self;
            }
          );
        in
        builtins.listToAttrs (
          map (packageName: {
            name = packageName;
            value = callPackage (./packages + "/${packageName}") { };
          }) packageNames
        );

      filterPackagesForSystem =
        system: unfilteredPackages:
        let
          packageSet = makePackageSet system;
        in
        nixpkgs.lib.filterAttrs (
          _name: package: nixpkgs.lib.meta.availableOn packageSet.stdenv.hostPlatform package
        ) unfilteredPackages;

      makePackages = system: filterPackagesForSystem system (makeUnfilteredPackages system);

      makeChecks =
        system:
        let
          packagesForSystem = self.packages.${system};

          packageChecks = builtins.listToAttrs (
            map (packageName: {
              name = "pkgs-${packageName}";
              value = packagesForSystem.${packageName};
            }) (builtins.attrNames packagesForSystem)
          );

          testChecks = builtins.listToAttrs (
            builtins.concatMap (
              packageName:
              let
                package = packagesForSystem.${packageName};
                tests = package.passthru.tests or { };
              in
              map (testName: {
                name = "pkgs-${packageName}-${testName}";
                value = tests.${testName};
              }) (builtins.attrNames tests)
            ) (builtins.attrNames packagesForSystem)
          );
        in
        packageChecks
        // testChecks
        // {
          devshell-default = self.devShells.${system}.default;
        };
    in
    {
      library = import ./library/default.nix { inherit inputs; };

      packages = forEachSupportedSystem makePackages;

      formatter = forEachSupportedSystem (system: self.packages.${system}.formatter);

      devShells = forEachSupportedSystem (
        system:
        let
          packageSet = makePackageSet system;
          packagesForSystem = self.packages.${system};
        in
        {
          default = import ./devshell.nix {
            pkgs = packageSet;
            packages = packagesForSystem;
          };
          automation = import ./devshell.nix {
            pkgs = packageSet;
            packages = packagesForSystem;
            includeAgents = false;
          };
        }
      );

      checks = forEachSupportedSystem makeChecks;
    };
}
