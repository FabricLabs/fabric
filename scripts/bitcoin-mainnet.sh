#!/bin/bash
bitcoind \
  -server \
  -txindex \
  -dbcache=4000 \
  -datadir=./stores/bitcoin-mainnet \
  -zmqpubrawblock=tcp://127.0.0.1:29500 \
  -zmqpubrawtx=tcp://127.0.0.1:29500 \
  -zmqpubhashtx=tcp://127.0.0.1:29500 \
  -zmqpubhashblock=tcp://127.0.0.1:29500 \
  -rpcbind=127.0.0.1 \
  -rpcuser='ahp7iuGhae8mooBahFaYieyaixei6too' \
  -rpcpassword='naiRe9wo5vieFayohje5aegheenoh4ee'
