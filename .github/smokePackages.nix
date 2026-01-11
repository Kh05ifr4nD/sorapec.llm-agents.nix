# Packages to build as a smoke test when flake inputs (e.g. nixpkgs) change.
#
# Used by `.github/workflows/ci.yml` via `nix eval`.
[
  "codex"
  "gemini-cli"
  "opencode"
]
