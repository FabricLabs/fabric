#include <string.h>
#include <secp256k1.h>
#include <secp256k1_extrakeys.h>
#include <secp256k1_schnorrsig.h>
#include <wally_crypto.h>
#include "secure_random.h"
#include <wally_core.h>
#include <wally_transaction.h>
#include <wally_transaction.h>
#include "taproot.h"
#include <wally_address.h>

// Tagged hash helper: SHA256(SHA256(tag)||SHA256(tag)||msg)
static FabricError tagged_hash_taptweak(const uint8_t *msg, size_t msg_len, uint8_t out32[32]) {
  static const char *tag = "TapTweak";
  if (msg_len > 64) return FABRIC_ERROR_BUFFER_TOO_SMALL;
  uint8_t tag_hash[32];
  if (wally_sha256((const unsigned char *)tag, strlen(tag), tag_hash, sizeof(tag_hash)) != WALLY_OK) {
    return FABRIC_ERROR_HASH_COMPUTATION_FAILED;
  }
  uint8_t buf[32 + 32 + 64];
  memcpy(buf, tag_hash, 32);
  memcpy(buf + 32, tag_hash, 32);
  memcpy(buf + 64, msg, msg_len);
  if (wally_sha256(buf, 64 + msg_len, out32, 32) != WALLY_OK) {
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

static secp256k1_context *g_secp_ctx = NULL;

FabricError fabric_taproot_init(void) {
  if (!g_secp_ctx) {
    g_secp_ctx = secp256k1_context_create(SECP256K1_CONTEXT_VERIFY);
    if (!g_secp_ctx) return FABRIC_ERROR_CRYPTO_INIT_FAILED;
  }
  return FABRIC_SUCCESS;
}

void fabric_taproot_cleanup(void) {
  if (g_secp_ctx) {
    secp256k1_context_destroy(g_secp_ctx);
    g_secp_ctx = NULL;
  }
}

FabricError fabric_taproot_tweak_xonly_pubkey(const uint8_t internal_x[32],
                                              const uint8_t *merkle_root32_or_null,
                                              uint8_t out_xonly[32]) {
  if (!internal_x || !out_xonly) return FABRIC_ERROR_NULL_POINTER;

  // Compute tweak = tagged_hash("TapTweak", internal_x || merkle_root)
  uint8_t msg[64];
  size_t msg_len = 32;
  memcpy(msg, internal_x, 32);
  if (merkle_root32_or_null) { memcpy(msg + 32, merkle_root32_or_null, 32); msg_len = 64; }
  uint8_t tweak[32];
  FabricError err = tagged_hash_taptweak(msg, msg_len, tweak);
  if (err != FABRIC_SUCCESS) return err;

  // Use libsecp256k1 to add tweak to x-only pubkey
  FabricError ierr = fabric_taproot_init();
  if (ierr != FABRIC_SUCCESS) return ierr;
  secp256k1_xonly_pubkey xpk;
  // internal_x is 32-byte x-only pubkey; parse directly
  if (secp256k1_xonly_pubkey_parse(g_secp_ctx, &xpk, internal_x) != 1) {
    return FABRIC_ERROR_INVALID_KEY;
  }
  secp256k1_pubkey pk_full;
  int pk_parity = 0;
  if (secp256k1_xonly_pubkey_tweak_add(g_secp_ctx, &pk_full, &xpk, tweak) != 1) {
    return FABRIC_ERROR_OPERATION_FAILED;
  }
  if (secp256k1_xonly_pubkey_from_pubkey(g_secp_ctx, &xpk, &pk_parity, &pk_full) != 1) {
    return FABRIC_ERROR_OPERATION_FAILED;
  }
  if (secp256k1_xonly_pubkey_serialize(g_secp_ctx, out_xonly, &xpk) != 1) {
    return FABRIC_ERROR_OPERATION_FAILED;
  }
  return FABRIC_SUCCESS;
}

FabricError fabric_taproot_keypath_sign(const uint8_t msg32[32],
                                        const uint8_t seckey[32],
                                        const uint8_t *merkle_root32_or_null,
                                        uint8_t out_sig64[64]) {
  if (!msg32 || !seckey || !out_sig64) return FABRIC_ERROR_NULL_POINTER;
  FabricError ierr = fabric_taproot_init();
  if (ierr != FABRIC_SUCCESS) return ierr;

  // Build keypair from internal secret key
  secp256k1_keypair keypair;
  if (secp256k1_keypair_create(g_secp_ctx, &keypair, seckey) != 1) {
    return FABRIC_ERROR_INVALID_KEY;
  }

  // Compute tweak = TapTweak(internal_x || merkle_root)
  secp256k1_xonly_pubkey xonly;
  int pk_parity = 0;
  if (secp256k1_keypair_xonly_pub(g_secp_ctx, &xonly, &pk_parity, &keypair) != 1) {
    return FABRIC_ERROR_OPERATION_FAILED;
  }
  uint8_t internal_x[32];
  if (secp256k1_xonly_pubkey_serialize(g_secp_ctx, internal_x, &xonly) != 1) {
    return FABRIC_ERROR_OPERATION_FAILED;
  }
  uint8_t msg[64];
  size_t msg_len = 32;
  memcpy(msg, internal_x, 32);
  if (merkle_root32_or_null) { memcpy(msg + 32, merkle_root32_or_null, 32); msg_len = 64; }
  uint8_t tweak[32];
  FabricError err = tagged_hash_taptweak(msg, msg_len, tweak);
  if (err != FABRIC_SUCCESS) return err;

  // Tweak the keypair in-place
  if (secp256k1_keypair_xonly_tweak_add(g_secp_ctx, &keypair, tweak) != 1) {
    return FABRIC_ERROR_OPERATION_FAILED;
  }

  // Sign using the tweaked keypair
  uint8_t aux_rand[32] = {0};
  if (fabric_secure_random_bytes(aux_rand, sizeof(aux_rand)) != FABRIC_SUCCESS) {
    memset(aux_rand, 0, sizeof(aux_rand));
  }
  if (secp256k1_schnorrsig_sign32(g_secp_ctx, out_sig64, msg32, &keypair, aux_rand) != 1) {
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
  const unsigned char *prog = (const unsigned char *)(spk + 2);
  char *addr = NULL;
  int ret = wally_addr_segwit_from_bytes(prog, 32, hrp, 0, &addr);
  if (ret != WALLY_OK || !addr) return FABRIC_ERROR_OPERATION_FAILED;
  size_t n = strlen(addr);
  if (n + 1 > out_addr_capacity) { wally_free_string(addr); return FABRIC_ERROR_BUFFER_TOO_SMALL; }
  memcpy(out_addr, addr, n + 1);
  wally_free_string(addr);
  return FABRIC_SUCCESS;
}


