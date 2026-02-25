#ifndef FABRIC_PROTOCOL_H
#define FABRIC_PROTOCOL_H

#include <stdint.h>
#include <stddef.h>
#include "errors.h"
#include "message.h"
#include "constants.h"

// Wire-level protocol message types (for Message.type)
// Preserve existing numeric assignments used elsewhere.
typedef enum {
  // Basic P2P
  PROTOCOL_HELLO = 0x00000011,            // greet after handshake
  PROTOCOL_PING = 0x00000012,             // matches examples/tests
  PROTOCOL_PONG = 0x00000013,             // matches examples/tests
  PROTOCOL_INVENTORY = 0x00000020,        // inventory request/announce

  // Reserved for future relays
  PROTOCOL_MESSAGE_RELAY = 0x00000040,

  // Contract state-machine messages (kept high to avoid conflicts)
  PROTOCOL_CONTRACT_OFFER = 0x00000100,
  PROTOCOL_CONTRACT_ACCEPT = 0x00000101,
  PROTOCOL_CONTRACT_UPDATE = 0x00000102,
  PROTOCOL_CONTRACT_EXECUTE = 0x00000103
} ProtocolMessageType;

// Contract messages (fixed-size bodies for easy hashing/R1CS mapping)
typedef struct {
  uint8_t contract_id[32];     // deterministic id (e.g., sha256 of terms)
  uint8_t terms_hash[32];      // commitment to off-chain terms/circuit
  uint64_t amount_sat;         // funding amount
  uint32_t locktime;           // absolute or relative (BIP68) policy
} ContractOffer;

typedef struct {
  uint8_t contract_id[32];
  uint8_t accept_hash[32];     // commitment to acceptor's terms (e.g., pubkey set)
} ContractAccept;

typedef struct {
  uint8_t contract_id[32];
  uint8_t state_root[32];      // state commitment (R1CS/GC compatible)
  uint32_t step;               // monotonic step
} ContractUpdate;

typedef struct {
  uint8_t contract_id[32];
  uint8_t result_hash[32];     // execution result commitment (or txid)
} ContractExecute;

// Builders (serialize into Message.body and set Message.type)
FabricError protocol_build_hello(Message* msg, const uint8_t node_id32[32], uint32_t network_magic, uint32_t features);
FabricError protocol_build_ping(Message* msg, uint64_t nonce);
FabricError protocol_build_pong(Message* msg, uint64_t nonce);

FabricError protocol_build_contract_offer(Message* msg, const ContractOffer* offer);
FabricError protocol_build_contract_accept(Message* msg, const ContractAccept* accept);
FabricError protocol_build_contract_update(Message* msg, const ContractUpdate* update);
FabricError protocol_build_contract_execute(Message* msg, const ContractExecute* exec_msg);

// Parsers (assume Message.type is checked by caller)
FabricError protocol_parse_hello(const Message* msg, uint8_t node_id32[32], uint32_t* network_magic, uint32_t* features);
FabricError protocol_parse_ping(const Message* msg, uint64_t* nonce);
FabricError protocol_parse_pong(const Message* msg, uint64_t* nonce);

FabricError protocol_parse_contract_offer(const Message* msg, ContractOffer* out);
FabricError protocol_parse_contract_accept(const Message* msg, ContractAccept* out);
FabricError protocol_parse_contract_update(const Message* msg, ContractUpdate* out);
FabricError protocol_parse_contract_execute(const Message* msg, ContractExecute* out);

// Wire header helpers (BE on the wire)
size_t protocol_header_size(void);
// Returns number of bytes written to out (header only). out_cap must be >= protocol_header_size()
size_t protocol_serialize_header(const Message* msg, uint8_t* out, size_t out_cap);
// Parses header from in; fills fields on out_msg (body left untouched)
FabricError protocol_parse_header(const uint8_t* in, size_t in_len, Message* out_msg);

// Body hash helpers moved to message.h as message_compute_body_hash/message_verify_body_hash

#endif // FABRIC_PROTOCOL_H


