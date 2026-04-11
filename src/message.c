#include <stdlib.h>
#include <string.h>
#include <stdio.h>
#include "timing_protection.h"
#include "message.h"
#include "validation.h"
#include "secure_memory.h"
#include <wally_crypto.h>

Message *message_create(void)
{
  Message *message = calloc(1, sizeof(Message));
  if (message)
  {
    message->magic = MESSAGE_MAGIC;
    message->version = MESSAGE_VERSION;
    message->type = 0;
    message->size = 0;
    message->body = NULL;
    memset(message->parent, 0, 32);
    memset(message->author, 0, 32);
    memset(message->hash, 0, 32);
    memset(message->preimage, 0, 32);
    memset(message->signature, 0, 64);
  }
  return message;
}

void message_destroy(Message *message)
{
  if (message)
  {
    // PHASE 2: Securely free message body
    if (message->body)
    {
      fabric_secure_free(message->body, message->size);
      message->body = NULL;
    }

    // Securely zero the entire message structure
    fabric_secure_zero(message, sizeof(Message));
    free(message);
  }
}

FabricError message_set_body(Message *message, const uint8_t *data, uint32_t size)
{
  FABRIC_CHECK_NULL(message);
  FABRIC_CHECK_NULL(data);
  FABRIC_CHECK_SIZE(size, MESSAGE_BODY_SIZE_MAX);

  // PHASE 2: Validate message size
  FabricError validation_result = fabric_validate_message_size(size);
  if (validation_result != FABRIC_SUCCESS)
  {
    return validation_result;
  }

  // Free existing body if any (securely)
  if (message->body)
  {
    fabric_secure_free(message->body, message->size);
    message->body = NULL;
    message->size = 0;
  }

  // Allocate and copy new body using secure allocation
  message->body = fabric_secure_malloc(size);
  if (!message->body)
  {
    return FABRIC_ERROR_OUT_OF_MEMORY;
  }

  // Use safe buffer copy
  validation_result = fabric_safe_buffer_copy(message->body, size, data, size);
  if (validation_result != FABRIC_SUCCESS)
  {
    fabric_secure_free(message->body, size);
    message->body = NULL;
    return validation_result;
  }

  message->size = size;
  return FABRIC_SUCCESS;
}

FabricError message_compute_hash(Message *message, const secp256k1_context *ctx)
{
  // Deprecated for signature flow: do not overwrite message->hash since it's used for wire body hash.
  // Keep as no-op success to avoid breaking older call sites.
  (void)message; (void)ctx;
  return FABRIC_SUCCESS;
}

static FabricError double_sha256_bytes(const uint8_t *data, size_t len, uint8_t out32[32])
{
  uint8_t tmp[32];
  if (wally_sha256(data, len, tmp, 32) != WALLY_OK) return FABRIC_ERROR_HASH_COMPUTATION_FAILED;
  if (wally_sha256(tmp, 32, out32, 32) != WALLY_OK) return FABRIC_ERROR_HASH_COMPUTATION_FAILED;
  return FABRIC_SUCCESS;
}

FabricError message_compute_body_hash(Message *message)
{
  FABRIC_CHECK_NULL(message);
  if (message->size > 0 && message->body)
  {
    return double_sha256_bytes(message->body, message->size, message->hash);
  }
  memset(message->hash, 0, 32);
  return FABRIC_SUCCESS;
}

FabricError message_verify_body_hash(const Message *message)
{
  FABRIC_CHECK_NULL(message);
  uint8_t calc[32];
  if (message->size > 0 && message->body)
  {
    FabricError r = double_sha256_bytes(message->body, message->size, calc);
    if (r != FABRIC_SUCCESS) return r;
  }
  else
  {
    memset(calc, 0, 32);
  }
  if (memcmp(calc, message->hash, 32) != 0) return FABRIC_ERROR_VERIFICATION_FAILED;
  return FABRIC_SUCCESS;
}

FabricError message_sign(Message *message, const uint8_t *private_key, const secp256k1_context *ctx)
{
  FABRIC_CHECK_NULL(message);
  FABRIC_CHECK_NULL(private_key);
  FABRIC_CHECK_NULL(ctx);

  // Compute tagged hash locally (do not modify message->hash which holds body hash for wire integrity)
  const char *tag = "Fabric/Message";
  size_t tag_len = strlen(tag);

  size_t data_size = offsetof(Message, body) + (message->body && message->size > 0 ? message->size : 0);
  uint8_t *data_buffer = malloc(data_size);
  if (!data_buffer) return FABRIC_ERROR_OUT_OF_MEMORY;

  size_t header_size = offsetof(Message, body);
  memcpy(data_buffer, message, header_size);
  if (message->body && message->size > 0)
  {
    memcpy(data_buffer + header_size, message->body, message->size);
  }

  uint8_t msghash[32];
  if (secp256k1_tagged_sha256(ctx, msghash, (const unsigned char *)tag, tag_len, data_buffer, data_size) != 1)
  {
    free(data_buffer);
    return FABRIC_ERROR_HASH_COMPUTATION_FAILED;
  }
  free(data_buffer);

  // Create a keypair from the private key
  secp256k1_keypair keypair;
  if (secp256k1_keypair_create(ctx, &keypair, private_key) != 1)
  {
    return FABRIC_ERROR_KEY_GENERATION_FAILED;
  }

  // Sign the hash using BIP-340 Schnorr
  if (secp256k1_schnorrsig_sign32(ctx, message->signature, msghash, &keypair, NULL) != 1)
  {
    return FABRIC_ERROR_SIGNATURE_FAILED;
  }

  // Get the x-only public key for the author field
  secp256k1_xonly_pubkey xonly_pubkey;
  int pk_parity;
  if (secp256k1_keypair_xonly_pub(ctx, &xonly_pubkey, &pk_parity, &keypair) != 1)
  {
    return FABRIC_ERROR_KEY_GENERATION_FAILED;
  }

  // Serialize the x-only public key to the author field (32 bytes)
  if (secp256k1_xonly_pubkey_serialize(ctx, message->author, &xonly_pubkey) != 1)
  {
    return FABRIC_ERROR_KEY_GENERATION_FAILED;
  }

  return FABRIC_SUCCESS;
}

FabricError message_verify(const Message *message, const secp256k1_context *ctx)
{
  FABRIC_CHECK_NULL(message);
  FABRIC_CHECK_NULL(ctx);

  // Parse the x-only public key from the author field
  secp256k1_xonly_pubkey pubkey;
  if (secp256k1_xonly_pubkey_parse(ctx, &pubkey, message->author) != 1)
  {
    return FABRIC_ERROR_INVALID_KEY;
  }

  // Recompute tagged hash for verification
  const char *tag = "Fabric/Message";
  size_t tag_len = strlen(tag);
  size_t data_size = offsetof(Message, body) + (message->body && message->size > 0 ? message->size : 0);
  uint8_t *data_buffer = malloc(data_size);
  if (!data_buffer) return FABRIC_ERROR_OUT_OF_MEMORY;
  size_t header_size = offsetof(Message, body);
  memcpy(data_buffer, message, header_size);
  if (message->body && message->size > 0)
  {
    memcpy(data_buffer + header_size, message->body, message->size);
  }
  uint8_t msghash[32];
  int ok = secp256k1_tagged_sha256(ctx, msghash, (const unsigned char *)tag, tag_len, data_buffer, data_size);
  free(data_buffer);
  if (ok != 1) return FABRIC_ERROR_HASH_COMPUTATION_FAILED;

  // Verify the Schnorr signature using recomputed hash
  if (secp256k1_schnorrsig_verify(ctx, message->signature, msghash, 32, &pubkey) != 1)
  {
    return FABRIC_ERROR_VERIFICATION_FAILED;
  }

  return FABRIC_SUCCESS;
}

char *message_to_hex(const Message *message)
{
  if (!message)
  {
    return NULL;
  }

  // Calculate total size needed for hex representation
  size_t total_size = sizeof(Message) - sizeof(uint8_t *) + message->size;
  size_t hex_size = total_size * 2 + 1; // 2 chars per byte + null terminator

  char *hex = malloc(hex_size);
  if (!hex)
  {
    return NULL;
  }

  // Convert header to hex (excluding body pointer)
  size_t header_size = offsetof(Message, body);
  for (size_t i = 0; i < header_size; i++)
  {
    sprintf(hex + (i * 2), "%02x", ((uint8_t *)message)[i]);
  }

  // Convert body to hex if it exists
  if (message->body && message->size > 0)
  {
    for (size_t i = 0; i < message->size; i++)
    {
      sprintf(hex + ((header_size + i) * 2), "%02x", message->body[i]);
    }
  }

  return hex;
}
