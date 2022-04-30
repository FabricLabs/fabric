#!/bin/bash
bitcoind \
  -regtest \
  -server \
  -datadir=./stores/bitcoin-b \
  -port=19445 \
  -rpcport=19444 \
  -zmqpubrawblock=tcp://127.0.0.1:29200 \
  -zmqpubrawtx=tcp://127.0.0.1:29200 \
  -zmqpubhashtx=tcp://127.0.0.1:29200 \
  -zmqpubhashblock=tcp://127.0.0.1:29200 \
  -rpcuser='ahp7iuGhae8mooBahFaYieyaixei6too' \
  -rpcpassword='naiRe9wo5vieFayohje5aegheenoh4ee'
