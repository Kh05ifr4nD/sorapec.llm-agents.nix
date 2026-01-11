{
  pkgs,
  packages,
  includeAgents ? true,
}:
pkgs.mkShellNoCC {
  packages = [
    # Tools needed for update scripts
    pkgs.bash
    pkgs.coreutils
    pkgs.curl
    pkgs.gh
    pkgs.git
    pkgs.gnugrep
    pkgs.gnused
    pkgs.jq
    pkgs.nix-prefetch-scripts
    pkgs.nix-update
    pkgs.nodejs
    pkgs.deno
  ]
  ++ pkgs.lib.optionals includeAgents [
    packages.opencode
  ]
  ++ pkgs.lib.optionals (includeAgents && pkgs.stdenv.hostPlatform.system == "x86_64-linux") [
    packages.ohMyOpencode
  ]
  ++ [

    # Formatter
    packages.formatter
  ];

  shellHook = ''
    export PROJECT_ROOT="$PWD"
    export OPENCODE_CONFIG_DIR="$PROJECT_ROOT/.opencode"
  '';
}
