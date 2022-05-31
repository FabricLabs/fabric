{ pkgs ? import <nixpkgs> {} }:

let
  nodePackages = import ./nix { inherit pkgs; };

in
{
  inherit (nodePackages) package;

  # This job checks if the automatically generated directory
  # ./node2nix-generated matches with the output of ./generate-node2nix.nix.
  check-node2nix-generated = pkgs.runCommandNoCC "check-node2nix-generated" {
    nativeBuildInputs = [ pkgs.diffutils ];
    actual = import ./nix/generate-node2nix.nix { inherit pkgs; };
    expected = ./nix/node2nix-generated;
  } ''
    diff -r -U 3 $actual $expected
    touch $out
  '';
}
