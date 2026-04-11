// BIP340 implementation backed by libsecp256k1 (schnorrsig + extrakeys)

#include <string.h>
#include <stdio.h>
#include <secp256k1.h>
#include <secp256k1_schnorrsig.h>
#include <secp256k1_extrakeys.h>
#include "bip340.h"
#include "secure_random.h"

static int g_bip340_initialized = 0;
static secp256k1_context *g_secp_ctx = NULL;

FabricError fabric_bip340_init(void)
{
  if (g_bip340_initialized) return FABRIC_SUCCESS;
  g_secp_ctx = secp256k1_context_create(SECP256K1_CONTEXT_SIGN | SECP256K1_CONTEXT_VERIFY);
  if (!g_secp_ctx) return FABRIC_ERROR_CRYPTO_INIT_FAILED;
  g_bip340_initialized = 1;
  return FABRIC_SUCCESS;
}

void fabric_bip340_cleanup(void)
{
  if (g_secp_ctx) {
    secp256k1_context_destroy(g_secp_ctx);
    g_secp_ctx = NULL;
  }
  g_bip340_initialized = 0;
}

static FabricError fabric_bip340_validate_seckey(uint8_t seckey[32])
{
  // Ensure non-zero and valid modulo group order
  if (secp256k1_ec_seckey_verify(g_secp_ctx, seckey) != 1) {
    return FABRIC_ERROR_INVALID_KEY;
  }
  return FABRIC_SUCCESS;
}

FabricError fabric_bip340_keygen(FabricBip340Keypair *out_keypair)
{
  if (!g_bip340_initialized) return FABRIC_ERROR_CRYPTO_INIT_FAILED;
  if (!out_keypair) return FABRIC_ERROR_NULL_POINTER;

  // Generate a valid random secret key
  FabricError ferr = FABRIC_SUCCESS;
  do {
    int rc = fabric_secure_random_bytes(out_keypair->private_key, FABRIC_SECP256K1_PRIVATE_KEY_SIZE);
    if (rc != FABRIC_SUCCESS) return FABRIC_ERROR_KEY_GENERATION_FAILED;
    ferr = fabric_bip340_validate_seckey(out_keypair->private_key);
  } while (ferr != FABRIC_SUCCESS);

  // Derive x-only public key
  return fabric_bip340_pubkey_from_private(out_keypair->private_key, out_keypair->xonly_public_key);
}

FabricError fabric_bip340_pubkey_from_private(const uint8_t private_key[FABRIC_SECP256K1_PRIVATE_KEY_SIZE],
                                              uint8_t out_xonly_pubkey[FABRIC_BIP340_XONLY_PUBLIC_KEY_SIZE])
{
  if (!g_bip340_initialized) return FABRIC_ERROR_CRYPTO_INIT_FAILED;
  if (!private_key || !out_xonly_pubkey) return FABRIC_ERROR_NULL_POINTER;

  if (fabric_bip340_validate_seckey((uint8_t *)private_key) != FABRIC_SUCCESS) {
    return FABRIC_ERROR_INVALID_KEY;
  }

  secp256k1_keypair keypair;
  if (secp256k1_keypair_create(g_secp_ctx, &keypair, private_key) != 1) {
    return FABRIC_ERROR_KEY_GENERATION_FAILED;
  }

  secp256k1_xonly_pubkey xonly;
  int pk_parity = 0;
  if (secp256k1_keypair_xonly_pub(g_secp_ctx, &xonly, &pk_parity, &keypair) != 1) {
    return FABRIC_ERROR_OPERATION_FAILED;
  }

  if (secp256k1_xonly_pubkey_serialize(g_secp_ctx, out_xonly_pubkey, &xonly) != 1) {
    return FABRIC_ERROR_OPERATION_FAILED;
  }

  return FABRIC_SUCCESS;
}

FabricError fabric_bip340_sign(const uint8_t msg32[32],
                               const uint8_t private_key[FABRIC_SECP256K1_PRIVATE_KEY_SIZE],
                               uint8_t out_signature[FABRIC_BIP340_SIGNATURE_SIZE])
{
  if (!g_bip340_initialized) return FABRIC_ERROR_CRYPTO_INIT_FAILED;
  if (!msg32 || !private_key || !out_signature) return FABRIC_ERROR_NULL_POINTER;

  if (fabric_bip340_validate_seckey((uint8_t *)private_key) != FABRIC_SUCCESS) {
    return FABRIC_ERROR_INVALID_KEY;
  }

  secp256k1_keypair keypair;
  if (secp256k1_keypair_create(g_secp_ctx, &keypair, private_key) != 1) {
    return FABRIC_ERROR_KEY_GENERATION_FAILED;
  }

  // Optional auxiliary randomness (32 bytes). Use secure random if available.
  uint8_t aux_rand[32];
  if (fabric_secure_random_bytes(aux_rand, sizeof(aux_rand)) != FABRIC_SUCCESS) {
    memset(aux_rand, 0, sizeof(aux_rand));
  }

  if (secp256k1_schnorrsig_sign32(g_secp_ctx, out_signature, msg32, &keypair, aux_rand) != 1) {
    return FABRIC_ERROR_SIGNATURE_FAILED;
  }

  // Clear sensitive data
  memset(aux_rand, 0, sizeof(aux_rand));
  memset(&keypair, 0, sizeof(keypair));

  return FABRIC_SUCCESS;
}

FabricError fabric_bip340_verify(const uint8_t *msg,
                                 size_t msg_len,
                                 const uint8_t xonly_pubkey[FABRIC_BIP340_XONLY_PUBLIC_KEY_SIZE],
                                 const uint8_t signature[FABRIC_BIP340_SIGNATURE_SIZE],
                                 int *out_valid)
{
  if (!g_bip340_initialized) return FABRIC_ERROR_CRYPTO_INIT_FAILED;
  if (!msg && msg_len != 0) return FABRIC_ERROR_NULL_POINTER;
  if (!xonly_pubkey || !signature || !out_valid) return FABRIC_ERROR_NULL_POINTER;

  secp256k1_xonly_pubkey pub;
  if (secp256k1_xonly_pubkey_parse(g_secp_ctx, &pub, xonly_pubkey) != 1) {
    *out_valid = 0;
    return FABRIC_ERROR_INVALID_KEY;
  }

  int ok = secp256k1_schnorrsig_verify(g_secp_ctx, signature, msg, msg_len, &pub);
  *out_valid = (ok == 1);
  return FABRIC_SUCCESS;
}


