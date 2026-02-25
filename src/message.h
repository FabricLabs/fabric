#ifndef MESSAGE_H
#define MESSAGE_H

#include <stdint.h>
#include <secp256k1.h>
#include <secp256k1_schnorrsig.h>
#include <secp256k1_extrakeys.h>
#include "errors.h"
#include "constants.h"

#define MESSAGE_MAGIC FABRIC_WIRE_MAGIC
#define MESSAGE_HASH_SIZE 32
#define MESSAGE_SIGNATURE_SIZE 64
#define MESSAGE_BODY_SIZE_MAX FABRIC_MAX_MESSAGE_BODY
#define MESSAGE_TYPE_INVENTORY 1
#define MESSAGE_VERSION FABRIC_MESSAGE_VERSION

#define BITCOIN_MAINNET_MAGIC FABRIC_NETWORK_MAGIC_MAINNET
#define BITCOIN_REGTEST_MAGIC FABRIC_NETWORK_MAGIC_REGTEST

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
// Double-SHA256(body) helpers used for wire-level integrity
FabricError message_compute_body_hash(Message *message);
FabricError message_verify_body_hash(const Message *message);
char *message_to_hex(const Message *message);

#endif // MESSAGE_H
