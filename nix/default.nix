{ pkgs ? import <nixpkgs> { inherit system; }
, system ? builtins.currentSystem
}:

let
  nodejs = pkgs.nodejs-12_x;

  nodePackages = import ./node2nix-generated {
    inherit pkgs nodejs system;
  };

  patchNodeGyp = name: nodePackages."${name}".override {
    buildInputs = [ pkgs.nodePackages.node-gyp-build ];
    preRebuild = ''
      sed -i -e "s|#!/usr/bin/env node|#! ${nodejs}/bin/node|" node_modules/node-gyp-build/bin.js
    '';
  };

in
  nodePackages // {
    nodeDependencies = patchNodeGyp "nodeDependencies";
    package = patchNodeGyp "package";
    shell = patchNodeGyp "shell";
    tarball = patchNodeGyp "tarball";
  }
