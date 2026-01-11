let
  flake = builtins.getFlake (toString ./..);
  packages = builtins.attrNames (flake.packages.x86_64-linux);

  extractMetadata =
    package:
    let
      license = package.meta.license or null;
      licenseString =
        if license == null then
          "Check package"
        else if builtins.isAttrs license && license ? spdxId then
          license.spdxId
        else if builtins.isAttrs license && license ? shortName then
          license.shortName
        else if builtins.isString license then
          license
        else
          "Check package";

      # Determine source type from sourceProvenance
      sourceProvenance = package.meta.sourceProvenance or null;
      sourceType =
        if sourceProvenance != null then
          if builtins.isList sourceProvenance then
            if builtins.any (s: s.shortName or "" == "fromSource") sourceProvenance then
              "source"
            else if builtins.any (s: s.shortName or "" == "binaryNativeCode") sourceProvenance then
              "binary"
            else if builtins.any (s: s.shortName or "" == "binaryBytecode") sourceProvenance then
              "bytecode"
            else
              "unknown"
          else
            "unknown"
        else
          "unknown";
    in
    {
      description = package.meta.description or "No description available";
      version = package.version or "unknown";
      license = licenseString;
      homepage = package.meta.homepage or null;
      sourceType = sourceType;
      hideFromDocumentation = package.passthru.hideFromDocs or false;
      hasMainProgram = builtins.hasAttr "mainProgram" package.meta;
      category = package.passthru.category or "Uncategorized";
    };

  results = builtins.listToAttrs (
    builtins.map (name: {
      name = name;
      value =
        let
          package = flake.packages.x86_64-linux.${name} or null;
          metadata = if package != null then extractMetadata package else null;
        in
        # Filter out packages with hideFromDocumentation = true or no mainProgram
        if
          metadata != null && !(metadata.hideFromDocumentation or false) && (metadata.hasMainProgram or false)
        then
          metadata
        else
          null;
    }) packages
  );
in
results
