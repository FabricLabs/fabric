#!/bin/bash

ORACLE_LISTEN_PORT=3000
PEER_LISTEN_PORT=7777

for i in 0 1 2 3 4 5 6
do
  NAME=swarm${i}
  PORT=$(($ORACLE_LISTEN_PORT + $i))
  PEER=$(($PEER_LISTEN_PORT + $i))
  PORT=$port PEER_PORT=$peer NAME=$name babel-node examples/cli.js &
done
