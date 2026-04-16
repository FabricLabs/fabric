/**
 * Native addon — crypto and Taproot stack (single translation unit).
 * Order: SHA-256/512 → secure memory/random → Bech32/segwit_addr → BIP340/Taproot.
 */
#include "sha2.c"
#include "security.c"
#include "../native/sipa/segwit_addr.c"
#include "taproot.c"
