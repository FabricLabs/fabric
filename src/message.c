#include <stdlib.h>
#include <string.h>
#include <stdio.h>
#include "timing_protection.h"
#include "message.h"

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
    memset(message->signature, 0, 64);
  }
  return message;
}

void message_destroy(Message *message)
{
  if (message)
  {
    if (message->body)
    {
      free(message->body);
    }
    free(message);
  }
}

FabricError message_set_body(Message *message, const uint8_t *data, uint32_t size)
{
  FABRIC_CHECK_NULL(message);
  FABRIC_CHECK_NULL(data);
  FABRIC_CHECK_SIZE(size, MESSAGE_BODY_SIZE_MAX);

  // Free existing body if any
  if (message->body)
  {
    free(message->body);
  }

  // Allocate and copy new body
  message->body = malloc(size);
  if (!message->body)
  {
    return FABRIC_ERROR_OUT_OF_MEMORY;
  }

  memcpy(message->body, data, size);
  message->size = size;

  return 0;
}

FabricError message_compute_hash(Message *message, const secp256k1_context *ctx)
{
  FABRIC_CHECK_NULL(message);
  FABRIC_CHECK_NULL(ctx);

  // Use secp256k1_tagged_sha256 for BIP-340 compliance
  // Tag: "Fabric/Message" for domain separation
  const char *tag = "Fabric/Message";
  size_t tag_len = strlen(tag);

  // Create a buffer with the message data to hash
  // Include all fields except signature
  size_t data_size = sizeof(Message) - sizeof(uint8_t *) + message->size;
  uint8_t *data_buffer = malloc(data_size);
  if (!data_buffer)
  {
    return FABRIC_ERROR_OUT_OF_MEMORY;
  }

  // Copy message header (excluding body pointer and signature)
  size_t header_size = offsetof(Message, body);
  memcpy(data_buffer, message, header_size);

  // Copy body if it exists
  if (message->body && message->size > 0)
  {
    memcpy(data_buffer + header_size, message->body, message->size);
  }

  // Compute tagged hash
  if (secp256k1_tagged_sha256(ctx, message->hash, (const unsigned char *)tag, tag_len, data_buffer, data_size) != 1)
  {
    free(data_buffer);
    return FABRIC_ERROR_HASH_COMPUTATION_FAILED;
  }

  free(data_buffer);
  return FABRIC_SUCCESS;
}

FabricError message_sign(Message *message, const uint8_t *private_key, const secp256k1_context *ctx)
{
  FABRIC_CHECK_NULL(message);
  FABRIC_CHECK_NULL(private_key);
  FABRIC_CHECK_NULL(ctx);

  // First compute the hash
  FABRIC_RETURN_ON_ERROR(message_compute_hash(message, ctx));

  // Create a keypair from the private key
  secp256k1_keypair keypair;
  if (secp256k1_keypair_create(ctx, &keypair, private_key) != 1)
  {
    return FABRIC_ERROR_KEY_GENERATION_FAILED;
  }

  // Sign the hash using BIP-340 Schnorr
  if (secp256k1_schnorrsig_sign32(ctx, message->signature, message->hash, &keypair, NULL) != 1)
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

  // Verify the Schnorr signature using secure verification with timing protection
  if (secp256k1_schnorrsig_verify(ctx, message->signature, message->hash, 32, &pubkey) != 1)
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
