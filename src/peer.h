#ifndef PEER_H
#define PEER_H

#include <stdint.h>
#include <noise/protocol.h>
#include <secp256k1.h>
#include <secp256k1_schnorrsig.h>
#include <secp256k1_extrakeys.h>
#include "message.h"
#include "errors.h"
#include "threads.h"
#include "scoring.h"

#define PEER_MAX_CONNECTIONS 100
#define PEER_BUFFER_SIZE 4096

typedef struct Connection
{
  int sock;
  NoiseCipherState *send_cipher;
  NoiseCipherState *recv_cipher;
  uint8_t remote_pubkey[32];
  int is_initiator;
  FabricMutex conn_mutex;         // Mutex for connection operations
  FabricCondition conn_condition; // Condition variable for connection events
  char peer_id[64];               // Peer identifier for scoring
  time_t connection_time;         // Connection establishment time
} Connection;

typedef struct Peer
{
  uint8_t public_key[33]; // Compressed secp256k1 public key
  uint8_t private_key[32];
  Connection connections[PEER_MAX_CONNECTIONS];
  FabricAtomicInt32 connection_count; // Thread-safe connection counter
  NoiseProtocolId protocol_id;
  secp256k1_context *secp256k1_ctx;
  FabricMutex peer_mutex;            // Mutex for peer operations
  FabricRWLock connections_rwlock;   // Read-write lock for connections
  PeerScoringSystem *scoring_system; // Peer scoring system
  char local_peer_id[64];            // Local peer identifier

  // Listening server state
  int listening_socket;
  bool is_listening;
  pthread_t listener_thread;
  FabricMutex listener_mutex;
} Peer;

// Initialization and cleanup
Peer *peer_create(void);
void peer_destroy(Peer *peer);

// Key management
FabricError peer_set_keypair(Peer *peer, const uint8_t *public_key, const uint8_t *private_key);
FabricError peer_generate_keypair(Peer *peer);

// Connection management
FabricError peer_connect(Peer *peer, const char *host, int port);
FabricError peer_accept(Peer *peer, int port);
FabricError peer_start_listening(Peer *peer, int port);
void peer_stop_listening(Peer *peer);
void peer_disconnect(Peer *peer, int connection_id);

// Message handling
FabricError peer_send_message(Peer *peer, int connection_id, const Message *message);
FabricError peer_receive_message(Peer *peer, int connection_id, Message *message);

// Add to function declarations:
FabricError peer_set_timeout(Peer *peer, int timeout_seconds);

// Peer scoring integration
FabricError peer_init_scoring(Peer *peer, uint32_t max_peers);
FabricError peer_record_behavior(Peer *peer, const char *peer_id, PeerBehaviorType behavior,
                                 const char *description);
FabricError peer_get_top_peers(Peer *peer, PeerScoringContext **peers, uint32_t max_peers,
                               uint32_t *actual_count);
bool peer_is_trusted(Peer *peer, const char *peer_id);
int32_t peer_get_score(Peer *peer, const char *peer_id);

// Internal handshake function (for testing)
FabricError perform_handshake(Connection *conn, const uint8_t *private_key, const uint8_t *public_key, int is_initiator);

#endif // PEER_H
