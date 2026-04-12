#include <string.h>
#include <secp256k1.h>
#include <secp256k1_extrakeys.h>
#include <secp256k1_schnorrsig.h>
#include "random.h"
#include "taproot.h"
#include "../native/sipa/segwit_addr.h"

// Shared secp256k1 context for BIP340 + Taproot operations.
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

FabricError fabric_bip340_get_context(const secp256k1_context **out_ctx)
{
  if (!out_ctx) return FABRIC_ERROR_NULL_POINTER;
  FabricError err = fabric_bip340_init();
  if (err != FABRIC_SUCCESS) return err;
  *out_ctx = g_secp_ctx;
  return FABRIC_SUCCESS;
}

// Use libsecp256k1's tagged hash implementation directly.
static FabricError tagged_hash_taptweak(const secp256k1_context *ctx,
                                        const uint8_t *msg,
                                        size_t msg_len,
                                        uint8_t out32[32]) {
  static const unsigned char tag[] = "TapTweak";
  if (!ctx || !msg || !out32) return FABRIC_ERROR_NULL_POINTER;
  if (secp256k1_tagged_sha256(ctx, out32, tag, strlen((const char *)tag), msg, msg_len) != 1) {
    return FABRIC_ERROR_HASH_COMPUTATION_FAILED;
  }
  return FABRIC_SUCCESS;
}

FabricError fabric_bip341_sighash_default(const uint8_t *tx_bytes,
                                          size_t tx_len,
                                          uint32_t input_index,
                                          const uint8_t *prevout_script,
                                          size_t prevout_script_len,
                                          uint64_t prevout_value,
                                          uint8_t out32[32]) {
  (void)tx_bytes; (void)tx_len; (void)input_index; (void)prevout_script; (void)prevout_script_len; (void)prevout_value; (void)out32;
  return FABRIC_ERROR_NOT_IMPLEMENTED;
}

static FabricError taproot_get_context(const secp256k1_context **ctx_out) {
  return fabric_bip340_get_context(ctx_out);
}

FabricError fabric_taproot_init(void) {
  return fabric_bip340_init();
}

void fabric_taproot_cleanup(void) {
  // Shared context is owned by the BIP340 module.
  fabric_bip340_cleanup();
}

FabricError fabric_taproot_tweak_xonly_pubkey(const uint8_t internal_x[32],
                                              const uint8_t *merkle_root32_or_null,
                                              uint8_t out_xonly[32]) {
  if (!internal_x || !out_xonly) return FABRIC_ERROR_NULL_POINTER;

  // Compute tweak = tagged_hash("TapTweak", internal_x || merkle_root)
  const secp256k1_context *ctx = NULL;
  FabricError ierr = taproot_get_context(&ctx);
  if (ierr != FABRIC_SUCCESS) return ierr;
  uint8_t msg[64];
  size_t msg_len = 32;
  memcpy(msg, internal_x, 32);
  if (merkle_root32_or_null) { memcpy(msg + 32, merkle_root32_or_null, 32); msg_len = 64; }
  uint8_t tweak[32];
  FabricError err = tagged_hash_taptweak(ctx, msg, msg_len, tweak);
  if (err != FABRIC_SUCCESS) return err;

  // Use libsecp256k1 to add tweak to x-only pubkey
  secp256k1_xonly_pubkey xpk;
  // internal_x is 32-byte x-only pubkey; parse directly
  if (secp256k1_xonly_pubkey_parse(ctx, &xpk, internal_x) != 1) {
    return FABRIC_ERROR_INVALID_KEY;
  }
  secp256k1_pubkey pk_full;
  int pk_parity = 0;
  if (secp256k1_xonly_pubkey_tweak_add(ctx, &pk_full, &xpk, tweak) != 1) {
    return FABRIC_ERROR_OPERATION_FAILED;
  }
  if (secp256k1_xonly_pubkey_from_pubkey(ctx, &xpk, &pk_parity, &pk_full) != 1) {
    return FABRIC_ERROR_OPERATION_FAILED;
  }
  if (secp256k1_xonly_pubkey_serialize(ctx, out_xonly, &xpk) != 1) {
    return FABRIC_ERROR_OPERATION_FAILED;
  }
  return FABRIC_SUCCESS;
}

FabricError fabric_taproot_keypath_sign(const uint8_t msg32[32],
                                        const uint8_t seckey[32],
                                        const uint8_t *merkle_root32_or_null,
                                        uint8_t out_sig64[64]) {
  if (!msg32 || !seckey || !out_sig64) return FABRIC_ERROR_NULL_POINTER;
  const secp256k1_context *ctx = NULL;
  FabricError ierr = taproot_get_context(&ctx);
  if (ierr != FABRIC_SUCCESS) return ierr;

  // Build keypair from internal secret key
  secp256k1_keypair keypair;
  if (secp256k1_keypair_create(ctx, &keypair, seckey) != 1) {
    return FABRIC_ERROR_INVALID_KEY;
  }

  // Compute tweak = TapTweak(internal_x || merkle_root)
  secp256k1_xonly_pubkey xonly;
  int pk_parity = 0;
  if (secp256k1_keypair_xonly_pub(ctx, &xonly, &pk_parity, &keypair) != 1) {
    return FABRIC_ERROR_OPERATION_FAILED;
  }
  uint8_t internal_x[32];
  if (secp256k1_xonly_pubkey_serialize(ctx, internal_x, &xonly) != 1) {
    return FABRIC_ERROR_OPERATION_FAILED;
  }
  uint8_t msg[64];
  size_t msg_len = 32;
  memcpy(msg, internal_x, 32);
  if (merkle_root32_or_null) { memcpy(msg + 32, merkle_root32_or_null, 32); msg_len = 64; }
  uint8_t tweak[32];
  FabricError err = tagged_hash_taptweak(ctx, msg, msg_len, tweak);
  if (err != FABRIC_SUCCESS) return err;

  // Tweak the keypair in-place
  if (secp256k1_keypair_xonly_tweak_add(ctx, &keypair, tweak) != 1) {
    return FABRIC_ERROR_OPERATION_FAILED;
  }

  // Sign using the tweaked keypair
  uint8_t aux_rand[32] = {0};
  if (fabric_secure_random_bytes(aux_rand, sizeof(aux_rand)) != FABRIC_SUCCESS) {
    memset(aux_rand, 0, sizeof(aux_rand));
  }
  if (secp256k1_schnorrsig_sign32(ctx, out_sig64, msg32, &keypair, aux_rand) != 1) {
    return FABRIC_ERROR_SIGNATURE_FAILED;
  }
  memset(aux_rand, 0, sizeof(aux_rand));
  memset(&keypair, 0, sizeof(keypair));
  return FABRIC_SUCCESS;
}

FabricError fabric_taproot_scriptpubkey_to_address(const uint8_t *spk,
                                                   size_t spk_len,
                                                   const char *hrp,
                                                   char *out_addr,
                                                   size_t out_addr_capacity) {
  if (!spk || spk_len != FABRIC_TAPROOT_SCRIPT_PUBKEY_SIZE || !hrp || !out_addr) return FABRIC_ERROR_NULL_POINTER;
  // Extract 32-byte witness program from OP_1 0x20 <32-bytes>
  if (spk_len < 34 || spk[0] != 0x51 || spk[1] != 0x20) return FABRIC_ERROR_INVALID_INPUT;
  // sipa segwit_addr_encode() uses witness version 1 for Taproot.
  if (!segwit_addr_encode(out_addr, hrp, 1, (const uint8_t *)(spk + 2), 32)) {
    return FABRIC_ERROR_OPERATION_FAILED;
  }
  if (strnlen(out_addr, out_addr_capacity) >= out_addr_capacity) {
    return FABRIC_ERROR_BUFFER_TOO_SMALL;
  }
  return FABRIC_SUCCESS;
}


