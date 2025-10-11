#ifndef MESSAGE_H
#define MESSAGE_H

#include <stdint.h>
#include <secp256k1.h>
#include <secp256k1_schnorrsig.h>
#include <secp256k1_extrakeys.h>
#include "errors.h"

#define MESSAGE_MAGIC 0xC0D3F33D
#define MESSAGE_HASH_SIZE 32
#define MESSAGE_SIGNATURE_SIZE 64
#define MESSAGE_BODY_SIZE_MAX 4096
#define MESSAGE_TYPE_INVENTORY 1
#define MESSAGE_VERSION 1

#define BITCOIN_MAINNET_MAGIC 0xF9BEB4D9
#define BITCOIN_REGTEST_MAGIC 0xFABFB5DA

typedef struct
{
  uint32_t magic;
  uint32_t version;
  uint8_t parent[32];
  uint8_t author[32];
  uint32_t type;
  uint32_t size;
  uint8_t hash[32];
  uint8_t signature[64];
  uint8_t *body;
} Message;

// Message creation and destruction
Message *message_create(void);
void message_destroy(Message *message);

// Message operations
FabricError message_set_body(Message *message, const uint8_t *data, uint32_t size);
FabricError message_verify(const Message *message, const secp256k1_context *ctx);
FabricError message_sign(Message *message, const uint8_t *private_key, const secp256k1_context *ctx);
FabricError message_compute_hash(Message *message, const secp256k1_context *ctx);
char *message_to_hex(const Message *message);

#endif // MESSAGE_H
