#!/bin/bash

# Import Bitcoin Opcodes
source ./bitcoin_opcodes.sh

# Key from Bitcoin
signer_address=$(bitcoin-cli -signet getnewaddress)
signer_pubkey=$(bitcoin-cli -signet getaddressinfo $signer_address | jq -r '.pubkey')

# Signing Script
# TODO: set pubkey length from actual pubkey length
block_signing_script="${OP_1}21${signer_pubkey}${OP_1}${OP_CHECKSIG}"

# Report to User
echo "${block_signing_script}" > "playnet-validator.script"
