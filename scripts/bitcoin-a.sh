#!/bin/bash
bitcoind \
  -regtest \
  -datadir=./stores/bitcoin-a \
  -port=18445 \
  -rpcport=18444 \
  -zmqpubrawblock=tcp://127.0.0.1:29100 \
  -zmqpubrawtx=tcp://127.0.0.1:29100 \
  -zmqpubhashtx=tcp://127.0.0.1:29100 \
  -zmqpubhashblock=tcp://127.0.0.1:29100 \
  -rpcuser='ahp7iuGhae8mooBahFaYieyaixei6too' \
  -rpcpassword='naiRe9wo5vieFayohje5aegheenoh4ee'
