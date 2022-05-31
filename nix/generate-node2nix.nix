# nix-building this expression returns a directory of Nix files for building the
# npm package in this directory.
#
# When you nix-shell this expression those automatically generated Nix files
# will be copied to the ./node2nix-generated directory.
#
# Note that ./default.nix contains the job `check-node2nix-generated` for
# checking if the output of this derivation matches the content of
# ./node2nix-generated.
{ pkgs ? import <nixpkgs> {} }:
let
  gitignore = pkgs.nix-gitignore.gitignoreSourcePure;

  node2nix-generated = pkgs.runCommandNoCC "node2nix-generated" {
    src = gitignore [".git" "nix" ../.gitignore] ../.;
    buildInputs = [ pkgs.gitMinimal pkgs.nodePackages.node2nix ];
  } ''
    mkdir $out
    node2nix \
      --input $src/package.json \
      --lock $src/package-lock.json \
      --output $out/nix/node2nix-generated/node-packages.nix \
      --composition $out/nix/node2nix-generated/default.nix \
      --node-env $out/nix/node2nix-generated/node-env.nix
    b=$(basename $src)
    sed "s|{nodeEnv,|{lib, nodeEnv,|;s|../$b|pkgs.nix-gitignore.gitignoreSourcePure [\".git\" ../.gitignore] ../.|" -i $out/node-packages.nix
  '';

in
  node2nix-generated.overrideAttrs (
    _old: {
      shellHook = pkgs.lib.optionalString pkgs.lib.inNixShell ''
        dest="${toString ./node2nix-generated}"
        rm -f "$dest"/*.nix "$dest"/README.md
        cp -v -t "$dest" "${node2nix-generated}"/*
        chmod u-w -R "$dest"/*
      '';
    }
  )
