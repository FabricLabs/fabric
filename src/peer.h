#ifndef PEER_H
#define PEER_H

#include <stdint.h>
#include <noise/protocol.h>
#include <secp256k1.h>
#include <secp256k1_schnorrsig.h>
#include <secp256k1_extrakeys.h>
#include "taproot.h"
#include "message.h"
#include "errors.h"
#include "threads.h"
#include "scoring.h"
#include "protocol.h"
#include "noise.h"

#define PEER_MAX_CONNECTIONS 100
#define PEER_BUFFER_SIZE 4096
#define PEER_MAX_EVENTS 50

// Peer connection mode
typedef enum {
  PEER_MODE_FABRIC = 0,
  PEER_MODE_LIGHTNING = 1
} PeerMode;

// Peer event structure
typedef struct
{
  char message[256];
  char peer_id[64];
  char ip[16];
  int port;
  bool connected;
  time_t timestamp;
} PeerEvent;

typedef struct Connection
{
  int sock;
  NoiseCipherState *send_cipher;
  NoiseCipherState *recv_cipher;
  uint8_t remote_pubkey[32];
  int is_initiator;
  int is_lightning;             // if true, Lightning TCP session (no Fabric handshake)
  FabricMutex conn_mutex;         // Mutex for connection operations
  FabricCondition conn_condition; // Condition variable for connection events
  char peer_id[64];               // Peer identifier for scoring
  time_t connection_time;         // Connection establishment time

  // Simple token-bucket rate limiter (per-connection)
  uint32_t rl_msg_tokens;         // current message tokens
  uint32_t rl_msg_capacity;       // max messages per interval
  uint32_t rl_msg_refill_per_sec; // refill rate (msgs/sec)
  uint32_t rl_byte_tokens;        // current byte tokens
  uint32_t rl_byte_capacity;      // max bytes per interval
  uint32_t rl_byte_refill_per_sec;// refill rate (bytes/sec)
  time_t rl_last_refill;          // last refill timestamp (seconds)
} Connection;

// Connection event callback function type
typedef void (*PeerConnectionCallback)(const char *peer_id, const char *ip, int port, bool connected);

typedef struct Peer
{
  uint8_t public_key[33]; // Compressed secp256k1 public key
  uint8_t private_key[32];
  Connection connections[PEER_MAX_CONNECTIONS];
  FabricAtomicInt32 connection_count; // Thread-safe connection counter
  NoiseProtocolId protocol_id;
  NoiseAppProtocol app_protocol;      // fabric | lightning for Noise prologue/params
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

  // Connection event callback
  PeerConnectionCallback connection_callback;

  // Event queue for connection events
  PeerEvent event_queue[PEER_MAX_EVENTS];
  int event_count;
  FabricMutex event_mutex;

  // Persistence
  bool persistence_enabled;
  char persist_path[256];
  uint32_t persist_interval_sec;
  time_t last_persist_time;

  // Maintenance thread for periodic tasks
  pthread_t maintenance_thread;
  bool maintenance_running;
} Peer;

// Initialization and cleanup
Peer *peer_create(void);
void peer_destroy(Peer *peer);

// Connection event callback
void peer_set_connection_callback(Peer *peer, PeerConnectionCallback callback);

// Protocol selection
void peer_set_protocol(Peer *peer, PeerMode mode);

// Event queue management
void peer_add_event(Peer *peer, const char *peer_id, const char *ip, int port, bool connected);
PeerEvent *peer_get_next_event(Peer *peer);
void peer_clear_events(Peer *peer);

// Key management
FabricError peer_set_keypair(Peer *peer, const uint8_t *public_key, const uint8_t *private_key);
FabricError peer_generate_keypair(Peer *peer);

// Connection management
FabricError peer_connect(Peer *peer, const char *host, int port);
FabricError peer_connect_with_mode(Peer *peer, const char *host, int port, PeerMode mode);
FabricError peer_accept(Peer *peer, int port);
FabricError peer_start_listening(Peer *peer, int port);
void peer_stop_listening(Peer *peer);
void peer_disconnect(Peer *peer, int connection_id);

// Message handling
FabricError peer_send_message(Peer *peer, int connection_id, const Message *message);
FabricError peer_receive_message(Peer *peer, int connection_id, Message *message);

// Add to function declarations:
FabricError peer_set_timeout(Peer *peer, int timeout_seconds);

// Basic protocol helpers
FabricError peer_send_hello(Peer *peer, int connection_id, uint32_t network_magic, uint32_t features);
FabricError peer_send_ping(Peer *peer, int connection_id, uint64_t nonce);
FabricError peer_send_pong(Peer *peer, int connection_id, uint64_t nonce);
FabricError peer_handle_basic_protocol(Peer *peer, int connection_id, const Message *incoming);
FabricError peer_receive_next_app_message(Peer *peer, int connection_id, Message *out_message);

// Peer scoring integration
FabricError peer_init_scoring(Peer *peer, uint32_t max_peers);
FabricError peer_record_behavior(Peer *peer, const char *peer_id, PeerBehaviorType behavior,
                                 const char *description);
FabricError peer_get_top_peers(Peer *peer, PeerScoringContext **peers, uint32_t max_peers,
                               uint32_t *actual_count);
bool peer_is_trusted(Peer *peer, const char *peer_id);
int32_t peer_get_score(Peer *peer, const char *peer_id);

// Internal handshake function
FabricError perform_handshake(Peer *peer, Connection *conn, int is_initiator);

// Persistence configuration and control
FabricError peer_set_persistence(Peer *peer, const char *path, uint32_t interval_sec, bool enabled);
FabricError peer_persist_now(Peer *peer);

#endif // PEER_H
