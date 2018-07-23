#!/bin/bash

ORACLE_LISTEN_PORT=3000
P2P_LISTEN_PORT=7777

for i in 0 1 2 3 4 5 6
do
  NAME=swarm${i}
  PORT=$(($ORACLE_LISTEN_PORT + $i))
  PEER=$(($ORACLE_LISTEN_PORT + $i))
  PORT=$port P2P_PORT=$peer NAME=$name babel-node examples/cli.js &
done
