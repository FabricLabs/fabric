{ pkgs ? import <nixpkgs> { inherit system; }
, system ? builtins.currentSystem
}:

let
  nodejs = pkgs.nodejs-12_x;

  nodePackages = import ./nix/node2nix-generated/default.nix {
    inherit pkgs nodejs system;
  };

in
  nodePackages // {
    nodeDependencies = nodePackages.nodeDependencies.override {
      buildInputs = [ pkgs.nodePackages.node-gyp-build ];
      preRebuild = ''
        sed -i -e "s|#!/usr/bin/env node|#! ${nodejs}/bin/node|" node_modules/node-gyp-build/bin.js
      '';
    };

    package = nodePackages.package.override {
      buildInputs = [ pkgs.nodePackages.node-gyp-build ];
      preRebuild = ''
        sed -i -e "s|#!/usr/bin/env node|#! ${nodejs}/bin/node|" node_modules/node-gyp-build/bin.js
      '';
    };

    shell = nodePackages.shell.override {
      buildInputs = [ pkgs.nodePackages.node-gyp-build ];
      preRebuild = ''
      sed -i -e "s|#!/usr/bin/env node|#! ${nodejs}/bin/node|" node_modules/node-gyp-build/bin.js
      '';
    };

    tarball = nodePackages.tarball.override {
      buildInputs = [ pkgs.nodePackages.node-gyp-build ];
      preRebuild = ''
        sed -i -e "s|#!/usr/bin/env node|#! ${nodejs}/bin/node|" node_modules/node-gyp-build/bin.js
      '';
    };
  }
