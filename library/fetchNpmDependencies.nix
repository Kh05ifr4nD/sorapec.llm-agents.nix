# Custom fetchNpmDependencies with packument caching support (fetcherVersion = 2)
# This builds a vendored prefetch-npm-deps with packument fetching support,
# which is needed for npm workspace support.
# TODO: Remove this once the upstream PR is merged into nixpkgs.
#
# Pin to nodejs_24 to ensure consistent npmDepsHash across nixpkgs versions.
{
  lib,
  stdenv,
  stdenvNoCC,
  rustPlatform,
  makeSetupHook,
  makeWrapper,
  pkg-config,
  curl,
  gnutar,
  gzip,
  cacert,
  config,
  nodejs_24,
  srcOnly,
  diffutils,
  jq,
}:
let
  nodejs = nodejs_24;

  # Build prefetch-npm-deps from vendored source with packument support
  prefetchNpmDependencies = rustPlatform.buildRustPackage {
    pname = "prefetch-npm-deps";
    version = "0.1.0-packument";

    src = ./prefetchNpmDependencies;

    cargoLock.lockFile = ./prefetchNpmDependencies/Cargo.lock;

    nativeBuildInputs = [
      makeWrapper
      pkg-config
    ];
    buildInputs = [ curl ];

    postInstall = ''
      wrapProgram "$out/bin/prefetch-npm-deps" --prefix PATH : ${
        lib.makeBinPath [
          gnutar
          gzip
        ]
      }
    '';

    meta = {
      description = "Prefetch dependencies from npm with packument support";
      mainProgram = "prefetch-npm-deps";
      license = lib.licenses.mit;
    };
  };

  npmConfigurationHookScript = builtins.toFile "npmConfigurationHook.sh" ''
    # shellcheck shell=bash
    # Vendored from nixpkgs with packument support additions
    # SC2016: Single quotes intentional - showing Nix syntax, not shell expansion
    # SC2086: Word splitting intentional for npm flags
    # SC2154: Variables set by buildNpmPackage, not this script
    # SC2164: pushd/popd in build hooks - failure will fail the build anyway

    # shellcheck disable=SC2016,SC2086,SC2154,SC2164

    npmConfigHook() {
      echo "Executing npmConfigHook"

      # Use npm patches in the nodejs package
      export NIX_NODEJS_BUILDNPMPACKAGE=1
      export prefetchNpmDependencies="@prefetchNpmDependencies@"

      if [ -n "''${npmRoot-}" ]; then
        pushd "$npmRoot"
      fi

      echo "Configuring npm"

      export HOME="$TMPDIR"
      export npm_config_nodedir="@nodeSrc@"
      export npm_config_node_gyp="@nodeGyp@"
      export npm_config_arch="@npmArch@"
      export npm_config_platform="@npmPlatform@"

      if [ -z "''${npmDeps-}" ]; then
        echo
        echo "ERROR: no dependencies were specified"
        echo 'Hint: set `npmDeps` if using these hooks individually. If this is happening with `buildNpmPackage`, please open an issue.'
        echo

        exit 1
      fi

      local -r cacheLockfile="$npmDeps/package-lock.json"
      if [[ -f npm-shrinkwrap.json ]]; then
        local -r srcLockfile="$PWD/npm-shrinkwrap.json"
      else
        local -r srcLockfile="$PWD/package-lock.json"
      fi

      echo "Validating consistency between $srcLockfile and $cacheLockfile"

      if ! @diff@ "$srcLockfile" "$cacheLockfile"; then
        # If the diff failed, first double-check that the file exists, so we can
        # give a friendlier error msg.
        if ! [ -e "$srcLockfile" ]; then
          echo
          echo "ERROR: Missing package-lock.json from src. Expected to find it at: $srcLockfile"
          echo "Hint: You can copy a vendored package-lock.json file via postPatch."
          echo

          exit 1
        fi

        if ! [ -e "$cacheLockfile" ]; then
          echo
          echo "ERROR: Missing lockfile from cache. Expected to find it at: $cacheLockfile"
          echo

          exit 1
        fi

        echo
        echo "ERROR: npmDepsHash is out of date"
        echo
        echo "The package-lock.json in src is not the same as the in $npmDeps."
        echo
        echo "To fix the issue:"
        echo '1. Use `lib.fakeHash` as the npmDepsHash value'
        echo "2. Build the derivation and wait for it to fail with a hash mismatch"
        echo "3. Copy the 'got: sha256-' value back into the npmDepsHash field"
        echo

        exit 1
      fi

      export CACHE_MAP_PATH="$TMP/MEOW"
      @prefetchNpmDependencies@ --map-cache

      @prefetchNpmDependencies@ --fixup-lockfile "$srcLockfile"

      local cachePath

      if [ -z "''${makeCacheWritable-}" ]; then
        cachePath="$npmDeps"
      else
        echo "Making cache writable"
        cp -r "$npmDeps" "$TMPDIR/cache"
        chmod -R 700 "$TMPDIR/cache"
        cachePath="$TMPDIR/cache"
      fi

      echo "Setting npm_config_cache to $cachePath"
      # do not use npm config to avoid modifying .npmrc
      export npm_config_cache="$cachePath"
      export npm_config_offline="true"
      export npm_config_progress="false"

      echo "Installing dependencies"

      if ! npm ci --ignore-scripts $npmInstallFlags "''${npmInstallFlagsArray[@]}" $npmFlags "''${npmFlagsArray[@]}"; then
        echo
        echo "ERROR: npm failed to install dependencies"
        echo
        echo "Here are a few things you can try, depending on the error:"
        echo '1. Set `makeCacheWritable = true`'
        echo "  Note that this won't help if npm is complaining about not being able to write to the logs directory -- look above that for the actual error."
        echo '2. Set `npmFlags = [ "--legacy-peer-deps" ]`'
        echo

        exit 1
      fi

      patchShebangs node_modules

      npm rebuild $npmRebuildFlags "''${npmRebuildFlagsArray[@]}" $npmFlags "''${npmFlagsArray[@]}"

      patchShebangs node_modules

      rm "$CACHE_MAP_PATH"
      unset CACHE_MAP_PATH

      if [ -n "''${npmRoot-}" ]; then
        popd
      fi

      echo "Finished npmConfigHook"
    }

    postPatchHooks+=(npmConfigHook)
  '';

  # Custom npmConfigurationHook that uses our patched prefetch-npm-deps
  npmConfigurationHook = makeSetupHook {
    name = "npm-config-hook-packument";
    substitutions = {
      nodeSrc = srcOnly nodejs;
      nodeGyp = "${nodejs}/lib/node_modules/npm/node_modules/node-gyp/bin/node-gyp.js";
      npmArch = stdenv.targetPlatform.node.arch;
      npmPlatform = stdenv.targetPlatform.node.platform;
      diff = "${diffutils}/bin/diff";
      jq = "${jq}/bin/jq";
      prefetchNpmDependencies = "${prefetchNpmDependencies}/bin/prefetch-npm-deps";
      nodeVersion = nodejs.version;
      nodeVersionMajor = lib.versions.major nodejs.version;
    };
  } npmConfigurationHookScript;

  fetchNpmDependenciesWithPackuments =
    {
      name ? "npm-deps",
      hash ? "",
      forceGitDependencies ? false,
      forceEmptyCache ? false,
      nativeBuildInputs ? [ ],
      npmRegistryOverridesString ? config.npmRegistryOverridesString or "{}",
      # Fetcher format version. Set to 2 to enable packument caching for workspace support.
      fetcherVersion ? 1,
      ...
    }@args:
    let
      hash_ =
        if hash != "" then
          { outputHash = hash; }
        else
          {
            outputHash = "";
            outputHashAlgo = "sha256";
          };

      forceGitDependencies_ = lib.optionalAttrs forceGitDependencies { FORCE_GIT_DEPS = true; };
      forceEmptyCache_ = lib.optionalAttrs forceEmptyCache { FORCE_EMPTY_CACHE = true; };
    in
    stdenvNoCC.mkDerivation (
      args
      // {
        inherit name;

        nativeBuildInputs = nativeBuildInputs ++ [ prefetchNpmDependencies ];

        buildPhase = ''
          runHook preBuild

          if [[ -f npm-shrinkwrap.json ]]; then
            local -r srcLockfile="npm-shrinkwrap.json"
          elif [[ -f package-lock.json ]]; then
            local -r srcLockfile="package-lock.json"
          else
            echo
            echo "ERROR: No lock file!"
            echo
            echo "package-lock.json or npm-shrinkwrap.json is required to make sure"
            echo "that npmDepsHash doesn't change when packages are updated on npm."
            echo
            echo "Hint: You can copy a vendored package-lock.json file via postPatch."
            echo

            exit 1
          fi

          prefetch-npm-deps $srcLockfile $out

          runHook postBuild
        '';

        dontInstall = true;

        impureEnvVars = lib.fetchers.proxyImpureEnvVars ++ [ "NIX_NPM_TOKENS" ];

        NIX_NPM_REGISTRY_OVERRIDES = npmRegistryOverridesString;

        # Fetcher version controls which features are enabled in prefetch-npm-deps
        # Version 2+ enables packument fetching for workspace support
        NPM_FETCHER_VERSION = toString fetcherVersion;

        SSL_CERT_FILE =
          if
            (
              hash_.outputHash == ""
              || hash_.outputHash == lib.fakeSha256
              || hash_.outputHash == lib.fakeSha512
              || hash_.outputHash == lib.fakeHash
            )
          then
            "${cacert}/etc/ssl/certs/ca-bundle.crt"
          else
            "/no-cert-file.crt";

        outputHashMode = "recursive";
      }
      // hash_
      // forceGitDependencies_
      // forceEmptyCache_
    );
in
{
  inherit fetchNpmDependenciesWithPackuments npmConfigurationHook prefetchNpmDependencies;
}
