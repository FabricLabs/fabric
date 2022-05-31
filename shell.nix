let
  pkgs = import <nixpkgs> {};
  nodePackages = import ./nix { inherit pkgs; };
in
  nodePackages.shell
