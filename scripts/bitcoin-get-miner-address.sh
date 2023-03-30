#!/bin/bash
bitcoin-cli \
  -regtest \
  -rpcport=20444 \
  -rpcuser='ahp7iuGhae8mooBahFaYieyaixei6too' \
  -rpcpassword='naiRe9wo5vieFayohje5aegheenoh4ee' \
  createwallet miner

bitcoin-cli \
  -regtest \
  -rpcport=20444 \
  -rpcuser='ahp7iuGhae8mooBahFaYieyaixei6too' \
  -rpcpassword='naiRe9wo5vieFayohje5aegheenoh4ee' \
  loadwallet miner

bitcoin-cli \
  -regtest \
  -rpcport=20444 \
  -rpcuser='ahp7iuGhae8mooBahFaYieyaixei6too' \
  -rpcpassword='naiRe9wo5vieFayohje5aegheenoh4ee' \
  getnewaddress "mining"

bitcoin-cli \
  -regtest \
  -rpcport=20444 \
  -rpcuser='ahp7iuGhae8mooBahFaYieyaixei6too' \
  -rpcpassword='naiRe9wo5vieFayohje5aegheenoh4ee' \
  getaddressesbylabel "mining"
