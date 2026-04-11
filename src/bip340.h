#ifndef FABRIC_BIP340_H
#define FABRIC_BIP340_H

#include <stdint.h>
#include <stddef.h>
#include "errors.h"

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

// Initialize the BIP340 module (e.g., secp256k1 context)
FabricError fabric_bip340_init(void);

// Cleanup any allocated resources
void fabric_bip340_cleanup(void);

// Generate a new random keypair (private key + x-only public key)
FabricError fabric_bip340_keygen(FabricBip340Keypair *out_keypair);

// Compute x-only public key from 32-byte private key
FabricError fabric_bip340_pubkey_from_private(const uint8_t private_key[FABRIC_SECP256K1_PRIVATE_KEY_SIZE],
                                              uint8_t out_xonly_pubkey[FABRIC_BIP340_XONLY_PUBLIC_KEY_SIZE]);

// Create BIP340 Schnorr signature: sig = 64 bytes (r||s)
FabricError fabric_bip340_sign(const uint8_t msg32[32],
                               const uint8_t private_key[FABRIC_SECP256K1_PRIVATE_KEY_SIZE],
                               uint8_t out_signature[FABRIC_BIP340_SIGNATURE_SIZE]);

// Verify BIP340 Schnorr signature
FabricError fabric_bip340_verify(const uint8_t *msg,
                                 size_t msg_len,
                                 const uint8_t xonly_pubkey[FABRIC_BIP340_XONLY_PUBLIC_KEY_SIZE],
                                 const uint8_t signature[FABRIC_BIP340_SIGNATURE_SIZE],
                                 int *out_valid);

#endif // FABRIC_BIP340_H


