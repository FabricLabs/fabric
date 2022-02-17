#!/bin/bash
bitcoin-qt \
  -regtest \
  -server \
  -datadir=./stores/bitcoin-playnet \
  -fallbackfee=0.00001 \
  -port=20445 \
  -rpcport=20444 \
  -connect=65.21.231.166:20445 \
  -zmqpubrawblock=tcp://127.0.0.1:29500 \
  -zmqpubrawtx=tcp://127.0.0.1:29500 \
  -zmqpubhashtx=tcp://127.0.0.1:29500 \
  -zmqpubhashblock=tcp://127.0.0.1:29500 \
  -rpcbind=127.0.0.1 \
  -rpcuser='ahp7iuGhae8mooBahFaYieyaixei6too' \
  -rpcpassword='naiRe9wo5vieFayohje5aegheenoh4ee'
