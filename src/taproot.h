#ifndef FABRIC_TAPROOT_H
#define FABRIC_TAPROOT_H

#include <stdint.h>
#include <stddef.h>
#include <secp256k1.h>
#include "errors.h"

// BIP341 Taproot v1 witness program sizes
#define FABRIC_TAPROOT_INTERNAL_KEY_SIZE 32
#define FABRIC_TAPROOT_SCRIPT_PUBKEY_SIZE (1 /*OP_1*/ + 1 /*push 32*/ + FABRIC_TAPROOT_INTERNAL_KEY_SIZE)

// BIP340 x-only public key and signature sizes
#define FABRIC_BIP340_XONLY_PUBLIC_KEY_SIZE 32
#define FABRIC_BIP340_SIGNATURE_SIZE 64
#define FABRIC_SECP256K1_PRIVATE_KEY_SIZE 32

// Keypair structure for convenience
typedef struct
{
  uint8_t private_key[FABRIC_SECP256K1_PRIVATE_KEY_SIZE];
  uint8_t xonly_public_key[FABRIC_BIP340_XONLY_PUBLIC_KEY_SIZE];
} FabricBip340Keypair;

// Build a Taproot v1 scriptPubKey (P2TR) for a given x-only internal key
// scriptPubKey = OP_1 (0x51) || 0x20 || 32-byte-internal-key
// out_script must be at least FABRIC_TAPROOT_SCRIPT_PUBKEY_SIZE bytes
static inline FabricError fabric_taproot_build_scriptpubkey(const uint8_t internal_key[FABRIC_TAPROOT_INTERNAL_KEY_SIZE],
                                                           uint8_t *out_script,
                                                           size_t out_script_capacity,
                                                           size_t *out_script_len)
{
  if (!internal_key || !out_script || !out_script_len)
  {
    return FABRIC_ERROR_NULL_POINTER;
  }

  if (out_script_capacity < FABRIC_TAPROOT_SCRIPT_PUBKEY_SIZE)
  {
    return FABRIC_ERROR_BUFFER_TOO_SMALL;
  }

  // Very basic sanity check: key not all-zero
  int all_zero = 1;
  for (size_t i = 0; i < FABRIC_TAPROOT_INTERNAL_KEY_SIZE; i++)
  {
    if (internal_key[i] != 0)
    {
      all_zero = 0;
      break;
    }
  }
  if (all_zero)
  {
    return FABRIC_ERROR_INVALID_KEY;
  }

  uint8_t *p = out_script;
  *p++ = 0x51;  // OP_1 (witness version 1)
  *p++ = 0x20;  // push 32 bytes
  for (size_t i = 0; i < FABRIC_TAPROOT_INTERNAL_KEY_SIZE; i++)
  {
    *p++ = internal_key[i];
  }

  *out_script_len = FABRIC_TAPROOT_SCRIPT_PUBKEY_SIZE;
  return FABRIC_SUCCESS;
}

// Compute BIP341 Taproot tweak and output tweaked x-only public key.
// tweak = tagged_hash("TapTweak", internal_x || merkle_root?)
// out_xonly is 32-byte x-only of tweaked pubkey
FabricError fabric_taproot_tweak_xonly_pubkey(const uint8_t internal_x[32],
                                              const uint8_t *merkle_root32_or_null,
                                              uint8_t out_xonly[32]);

// Taproot key-path signer: tweaks internal seckey with optional merkle root and signs msg32
FabricError fabric_taproot_keypath_sign(const uint8_t msg32[32],
                                        const uint8_t seckey[32],
                                        const uint8_t *merkle_root32_or_null,
                                        uint8_t out_sig64[64]);

// Compute BIP341 SIGHASH_DEFAULT for a single input
// tx_bytes: serialized transaction (no witness required)
// input_index: index of input being signed
// prevout_script: scriptPubKey of the prevout (e.g., P2TR witness program)
// prevout_value: value in satoshis of the prevout
FabricError fabric_bip341_sighash_default(const uint8_t *tx_bytes,
                                          size_t tx_len,
                                          uint32_t input_index,
                                          const uint8_t *prevout_script,
                                          size_t prevout_script_len,
                                          uint64_t prevout_value,
                                          uint8_t out32[32]);

// Convert a Taproot P2TR scriptPubKey to a bech32m address (e.g., bc1p...)
// hrp: network prefix, e.g., "bc" or "tb".
FabricError fabric_taproot_scriptpubkey_to_address(const uint8_t *spk,
                                                   size_t spk_len,
                                                   const char *hrp,
                                                   char *out_addr,
                                                   size_t out_addr_capacity);

// Initialize Taproot/secp context (idempotent)
FabricError fabric_taproot_init(void);
void fabric_taproot_cleanup(void);

// BIP340 API (implemented alongside Taproot in C core)
FabricError fabric_bip340_init(void);
void fabric_bip340_cleanup(void);
FabricError fabric_bip340_keygen(FabricBip340Keypair *out_keypair);
FabricError fabric_bip340_pubkey_from_private(const uint8_t private_key[FABRIC_SECP256K1_PRIVATE_KEY_SIZE],
                                              uint8_t out_xonly_pubkey[FABRIC_BIP340_XONLY_PUBLIC_KEY_SIZE]);
FabricError fabric_bip340_sign(const uint8_t msg32[32],
                               const uint8_t private_key[FABRIC_SECP256K1_PRIVATE_KEY_SIZE],
                               uint8_t out_signature[FABRIC_BIP340_SIGNATURE_SIZE]);
FabricError fabric_bip340_verify(const uint8_t *msg,
                                 size_t msg_len,
                                 const uint8_t xonly_pubkey[FABRIC_BIP340_XONLY_PUBLIC_KEY_SIZE],
                                 const uint8_t signature[FABRIC_BIP340_SIGNATURE_SIZE],
                                 int *out_valid);
FabricError fabric_bip340_get_context(const secp256k1_context **out_ctx);
void fabric_bip340_release_context(void);

#endif // FABRIC_TAPROOT_H


