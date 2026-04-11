#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <arpa/inet.h>
#include <sys/socket.h>
#include <noise/protocol.h>
#include <errno.h>
#include <netinet/in.h>
#include <netinet/tcp.h>
#include <fcntl.h> // Required for fcntl
#include <stdio.h>
#include <sys/stat.h>

#include "peer.h"
#include "message.h"
#include "protocol.h"
#include "secure_random.h"
#include "secure_memory.h"
#include "validation.h"
#include "scoring.h"
#include "datadir.h"

#ifndef MSG_NOSIGNAL
#define MSG_NOSIGNAL 0
#endif

static void peer_flag_and_disconnect(Peer *peer, int connection_id, PeerBehaviorType behavior, const char *reason)
{
  if (!peer) return;
  // Best-effort scoring update
  if (peer->scoring_system)
  {
    // Use connection's peer_id if available
    const char *peer_id = NULL;
    if (fabric_rwlock_rdlock(&peer->connections_rwlock) == THREAD_SUCCESS) {
      if (connection_id >= 0 && connection_id < PEER_MAX_CONNECTIONS) {
        peer_id = peer->connections[connection_id].peer_id;
      }
      fabric_rwlock_unlock(&peer->connections_rwlock);
    }
    if (peer_id && *peer_id) {
      peer_scoring_record_behavior(peer->scoring_system, peer_id, behavior, -SCORE_BAD_BEHAVIOR_WEIGHT, reason, NULL);
    }
  }
  peer_disconnect(peer, connection_id);
}

static FabricError peer_write_peers_file(Peer *peer)
{
  if (!peer || !peer->scoring_system || !peer->persistence_enabled || !peer->persist_path[0]) return FABRIC_SUCCESS;
  FILE *f = fopen(peer->persist_path, "wb");
  if (!f) return FABRIC_ERROR_FILE_OPERATION_FAILED;

  // Simple binary format: [magic][version][count] then entries: [peer_id(64)][score(int32)][is_banned(uint8)][ban_expiry(int64)][last_activity(int64)]
  const uint32_t magic = 0x50454552; // 'PEER'
  const uint32_t version = 1;
  fwrite(&magic, sizeof(magic), 1, f);
  fwrite(&version, sizeof(version), 1, f);

  uint32_t count = peer->scoring_system->peer_count;
  fwrite(&count, sizeof(count), 1, f);

  for (uint32_t i = 0; i < peer->scoring_system->peer_count; i++)
  {
    PeerScoringContext *ctx = peer->scoring_system->peers[i];
    if (!ctx) continue;
    char idbuf[64]; memset(idbuf, 0, sizeof(idbuf));
    strncpy(idbuf, ctx->peer_id, sizeof(idbuf) - 1);
    fwrite(idbuf, sizeof(idbuf), 1, f);
    fwrite(&ctx->stats.current_score, sizeof(ctx->stats.current_score), 1, f);
    uint8_t banned = ctx->is_banned ? 1 : 0;
    fwrite(&banned, sizeof(banned), 1, f);
    fwrite(&ctx->ban_expiry, sizeof(ctx->ban_expiry), 1, f);
    fwrite(&ctx->stats.last_activity, sizeof(ctx->stats.last_activity), 1, f);
  }

  fclose(f);
  return FABRIC_SUCCESS;
}

static FabricError peer_read_peers_file(Peer *peer)
{
  if (!peer || !peer->scoring_system || !peer->persist_path[0]) return FABRIC_SUCCESS;
  FILE *f = fopen(peer->persist_path, "rb");
  if (!f) return FABRIC_SUCCESS; // no file yet

  uint32_t magic = 0, version = 0, count = 0;
  if (fread(&magic, sizeof(magic), 1, f) != 1 || fread(&version, sizeof(version), 1, f) != 1)
  { fclose(f); return FABRIC_ERROR_FILE_OPERATION_FAILED; }
  if (magic != 0x50454552 || version != 1)
  { fclose(f); return FABRIC_ERROR_MESSAGE_INVALID_VERSION; }
  if (fread(&count, sizeof(count), 1, f) != 1)
  { fclose(f); return FABRIC_ERROR_FILE_OPERATION_FAILED; }

  for (uint32_t i = 0; i < count; i++)
  {
    char idbuf[64]; int32_t score; uint8_t banned; time_t ban_expiry; time_t last_activity;
    if (fread(idbuf, sizeof(idbuf), 1, f) != 1) break;
    if (fread(&score, sizeof(score), 1, f) != 1) break;
    if (fread(&banned, sizeof(banned), 1, f) != 1) break;
    if (fread(&ban_expiry, sizeof(ban_expiry), 1, f) != 1) break;
    if (fread(&last_activity, sizeof(last_activity), 1, f) != 1) break;

    if (idbuf[0])
    {
      if (!peer_scoring_get_peer(peer->scoring_system, idbuf))
      {
        peer_scoring_add_peer(peer->scoring_system, idbuf);
      }
      peer_scoring_set_score(peer->scoring_system, idbuf, score);
      PeerScoringContext *ctx = peer->scoring_system->peers[i];
      if (ctx)
      {
        ctx->is_banned = (banned != 0);
        ctx->ban_expiry = ban_expiry;
        ctx->stats.last_activity = last_activity;
      }
    }
  }

  fclose(f);
  return FABRIC_SUCCESS;
}

static void *maintenance_thread_function(void *arg)
{
  Peer *peer = (Peer *)arg;
  while (peer && peer->maintenance_running)
  {
    if (peer->persistence_enabled)
    {
      time_t now_tick = time(NULL);
      if (now_tick - peer->last_persist_time >= (time_t)peer->persist_interval_sec)
      {
        peer->last_persist_time = now_tick;
        (void)peer_write_peers_file(peer);
      }
    }
    usleep(200 * 1000); // 200ms tick
  }
  return NULL;
}

FabricError peer_set_persistence(Peer *peer, const char *path, uint32_t interval_sec, bool enabled)
{
  if (!peer || !path) return FABRIC_ERROR_INVALID_INPUT;
  size_t len = strnlen(path, sizeof(peer->persist_path) - 1);
  if (len == 0) return FABRIC_ERROR_INVALID_INPUT;
  strncpy(peer->persist_path, path, sizeof(peer->persist_path) - 1);
  peer->persist_interval_sec = interval_sec ? interval_sec : 60;
  peer->persistence_enabled = enabled;
  // Best-effort load existing file
  return peer_read_peers_file(peer);
}

FabricError peer_persist_now(Peer *peer)
{
  return peer_write_peers_file(peer);
}

static NoiseProtocolId protocol_id = {0};

FabricError perform_handshake(Peer *peer, Connection *conn, int is_initiator)
{
  NoiseHandshakeState *handshake = NULL;
  uint8_t buffer[PEER_BUFFER_SIZE];
  int handshake_complete = 0;
  int timeout_count = 0;
  const int max_timeout = 100; // 100 attempts before timeout

  // Initialize handshake state with protocol id selected for current peer app
  NoiseProtocolId pid; noise_get_protocol_id(peer->app_protocol, &pid);
  if (noise_handshakestate_new_by_id(&handshake, &pid,
                                     is_initiator ? NOISE_ROLE_INITIATOR : NOISE_ROLE_RESPONDER) != NOISE_ERROR_NONE)
  {
    return FABRIC_ERROR_NOISE_INIT_FAILED;
  }

  // Set prologue according to peer app_protocol
  size_t prologue_len = 0;
  const uint8_t *prologue = noise_get_prologue(conn->is_lightning ? NOISE_PROTOCOL_LIGHTNING : NOISE_PROTOCOL_FABRIC, &prologue_len);
  if (noise_handshakestate_set_prologue(handshake, prologue, prologue_len) != NOISE_ERROR_NONE)
  {
    goto cleanup;
  }

  // Set keypairs
  NoiseDHState *dh = noise_handshakestate_get_local_keypair_dh(handshake);
  if (!dh)
    goto cleanup;

  if (noise_dhstate_set_keypair_private(dh, peer->private_key, 32) != NOISE_ERROR_NONE)
  {
    goto cleanup;
  }

  if (conn->remote_pubkey[0] || conn->remote_pubkey[1])
  {
    dh = noise_handshakestate_get_remote_public_key_dh(handshake);
    if (!dh)
      goto cleanup;
    if (noise_dhstate_set_public_key(dh, conn->remote_pubkey, 32) != NOISE_ERROR_NONE)
    {
      goto cleanup;
    }
  }

  // Start handshake
  if (noise_handshakestate_start(handshake) != NOISE_ERROR_NONE)
  {
    goto cleanup;
  }

  // Perform handshake
  while (!handshake_complete && timeout_count < max_timeout)
  {
    int action = noise_handshakestate_get_action(handshake);

    switch (action)
    {
    case NOISE_ACTION_WRITE_MESSAGE:
    {
      NoiseBuffer mbuf;
      mbuf.data = buffer;
      mbuf.size = 0;
      mbuf.max_size = sizeof(buffer);

      if (noise_handshakestate_write_message(handshake, &mbuf, NULL) != NOISE_ERROR_NONE)
      {
        goto cleanup;
      }

      ssize_t sent = send(conn->sock, mbuf.data, mbuf.size, MSG_NOSIGNAL);
      if (sent < 0)
      {
        if (errno == EAGAIN || errno == EWOULDBLOCK)
        {
          usleep(1000); // 1ms delay
          timeout_count++;
          continue;
        }
        goto cleanup;
      }
      if ((size_t)sent != mbuf.size)
      {
        goto cleanup;
      }
      break;
    }

    case NOISE_ACTION_READ_MESSAGE:
    {
      ssize_t bytes = recv(conn->sock, buffer, sizeof(buffer), 0);
      if (bytes < 0)
      {
        if (errno == EAGAIN || errno == EWOULDBLOCK)
        {
          usleep(1000); // 1ms delay
          timeout_count++;
          continue;
        }
        goto cleanup;
      }
      if (bytes == 0)
      {
        // Connection closed
        goto cleanup;
      }

      NoiseBuffer mbuf;
      mbuf.data = buffer;
      mbuf.size = (size_t)bytes;
      mbuf.max_size = sizeof(buffer);

      if (noise_handshakestate_read_message(handshake, &mbuf, NULL) != NOISE_ERROR_NONE)
      {
        goto cleanup;
      }
      break;
    }

    case NOISE_ACTION_SPLIT:
    {
      if (noise_handshakestate_split(handshake, &conn->send_cipher, &conn->recv_cipher) != NOISE_ERROR_NONE)
      {
        goto cleanup;
      }
      handshake_complete = 1;
      break;
    }

    default:
      goto cleanup;
    }
  }

  if (timeout_count >= max_timeout)
  {
    goto cleanup;
  }

  noise_handshakestate_free(handshake);
  return FABRIC_SUCCESS;

cleanup:
  if (handshake)
    noise_handshakestate_free(handshake);
  return FABRIC_ERROR_NOISE_HANDSHAKE_FAILED;
}

Peer *peer_create(void)
{
  Peer *peer = calloc(1, sizeof(Peer));
  if (peer)
  {
    // Default to fabric Noise parameters
    noise_get_protocol_id(NOISE_PROTOCOL_FABRIC, &protocol_id);
    peer->protocol_id = protocol_id;
    peer->app_protocol = NOISE_PROTOCOL_FABRIC;

    // Initialize thread-safe connection counter
    if (fabric_atomic_int32_init(&peer->connection_count, "peer_connection_count", 0) != THREAD_SUCCESS)
    {
      free(peer);
      return NULL;
    }

    // Initialize peer mutex
    if (fabric_mutex_init(&peer->peer_mutex, "peer_mutex") != THREAD_SUCCESS)
    {
      fabric_atomic_int32_destroy(&peer->connection_count);
      free(peer);
      return NULL;
    }

    // Initialize connections read-write lock
    if (fabric_rwlock_init(&peer->connections_rwlock, "connections_rwlock") != THREAD_SUCCESS)
    {
      fabric_mutex_destroy(&peer->peer_mutex);
      fabric_atomic_int32_destroy(&peer->connection_count);
      free(peer);
      return NULL;
    }

    // Initialize listening server state
    peer->listening_socket = -1;
    peer->is_listening = false;

    // Initialize all connection sockets to -1 (invalid)
    for (int i = 0; i < PEER_MAX_CONNECTIONS; i++)
    {
      peer->connections[i].sock = -1;
    }

    // Initialize connection callback to NULL
    peer->connection_callback = NULL;

    // Initialize event queue
    peer->event_count = 0;
    if (fabric_mutex_init(&peer->event_mutex, "event_mutex") != THREAD_SUCCESS)
    {
      fabric_rwlock_destroy(&peer->connections_rwlock);
      fabric_mutex_destroy(&peer->peer_mutex);
      fabric_atomic_int32_destroy(&peer->connection_count);
      free(peer);
      return NULL;
    }

    if (fabric_mutex_init(&peer->listener_mutex, "listener_mutex") != THREAD_SUCCESS)
    {
      fabric_rwlock_destroy(&peer->connections_rwlock);
      fabric_mutex_destroy(&peer->peer_mutex);
      fabric_atomic_int32_destroy(&peer->connection_count);
      free(peer);
      return NULL;
    }

    // Initialize secp256k1 context
    peer->secp256k1_ctx = secp256k1_context_create(SECP256K1_CONTEXT_SIGN | SECP256K1_CONTEXT_VERIFY);
    if (!peer->secp256k1_ctx)
    {
      fabric_rwlock_destroy(&peer->connections_rwlock);
      fabric_mutex_destroy(&peer->peer_mutex);
      fabric_atomic_int32_destroy(&peer->connection_count);
      free(peer);
      return NULL;
    }
    // Initialize persistence defaults
    peer->persistence_enabled = true;
    char dd[512];
    if (fabric_get_default_datadir(dd, sizeof(dd)) == FABRIC_SUCCESS)
    {
      snprintf(peer->persist_path, sizeof(peer->persist_path), "%s/%s", dd, "peers.dat");
    }
    else
    {
      snprintf(peer->persist_path, sizeof(peer->persist_path), "peers.dat");
    }
    peer->persist_interval_sec = 60; // default 60s
    peer->last_persist_time = time(NULL);
    peer->maintenance_running = true;
    pthread_create(&peer->maintenance_thread, NULL, maintenance_thread_function, peer);
  }
  return peer;
}

void peer_set_connection_callback(Peer *peer, PeerConnectionCallback callback)
{
  if (peer)
  {
    peer->connection_callback = callback;
  }
}

void peer_add_event(Peer *peer, const char *peer_id, const char *ip, int port, bool connected)
{
  if (!peer)
    return;

  if (fabric_mutex_lock(&peer->event_mutex) != THREAD_SUCCESS)
    return;

  // Shift events if queue is full
  if (peer->event_count >= PEER_MAX_EVENTS)
  {
    for (int i = 0; i < PEER_MAX_EVENTS - 1; i++)
    {
      peer->event_queue[i] = peer->event_queue[i + 1];
    }
    peer->event_count = PEER_MAX_EVENTS - 1;
  }

  // Add new event
  PeerEvent *event = &peer->event_queue[peer->event_count];
  snprintf(event->message, sizeof(event->message),
           connected ? "Peer %s connected from %s:%d" : "Peer %s disconnected",
           peer_id, ip, port);
  strncpy(event->peer_id, peer_id, sizeof(event->peer_id) - 1);
  strncpy(event->ip, ip, sizeof(event->ip) - 1);
  event->port = port;
  event->connected = connected;
  event->timestamp = time(NULL);

  peer->event_count++;

  fabric_mutex_unlock(&peer->event_mutex);
}

PeerEvent *peer_get_next_event(Peer *peer)
{
  if (!peer || peer->event_count == 0)
    return NULL;

  if (fabric_mutex_lock(&peer->event_mutex) != THREAD_SUCCESS)
    return NULL;

  if (peer->event_count == 0)
  {
    fabric_mutex_unlock(&peer->event_mutex);
    return NULL;
  }

  // Return the oldest event (index 0)
  PeerEvent *event = &peer->event_queue[0];

  // Shift remaining events
  for (int i = 0; i < peer->event_count - 1; i++)
  {
    peer->event_queue[i] = peer->event_queue[i + 1];
  }
  peer->event_count--;

  fabric_mutex_unlock(&peer->event_mutex);
  return event;
}

void peer_clear_events(Peer *peer)
{
  if (!peer)
    return;

  if (fabric_mutex_lock(&peer->event_mutex) != THREAD_SUCCESS)
    return;
  peer->event_count = 0;
  fabric_mutex_unlock(&peer->event_mutex);
}

void peer_destroy(Peer *peer)
{
  if (!peer)
    return;

  // SECURITY: Securely zero sensitive data before cleanup
  fabric_secure_zero(peer->private_key, 32);

  // Clean up secp256k1 context
  if (peer->secp256k1_ctx)
  {
    secp256k1_context_destroy(peer->secp256k1_ctx);
  }

  // Clean up all connections safely: disconnect active slots until none remain
  while (1)
  {
    int32_t conn_count = 0;
    if (fabric_atomic_int32_get(&peer->connection_count, &conn_count) != THREAD_SUCCESS)
    {
      break;
    }
    if (conn_count <= 0)
    {
      break;
    }
    int found = -1;
    if (fabric_rwlock_rdlock(&peer->connections_rwlock) == THREAD_SUCCESS) {
      for (int i = 0; i < PEER_MAX_CONNECTIONS; i++) {
        if (peer->connections[i].sock >= 0) { found = i; break; }
      }
      fabric_rwlock_unlock(&peer->connections_rwlock);
    }
    if (found < 0) break;
    peer_disconnect(peer, found);
  }

  // Stop listening if active
  peer_stop_listening(peer);

  // Clean up thread safety primitives
  fabric_rwlock_destroy(&peer->connections_rwlock);
  fabric_mutex_destroy(&peer->peer_mutex);
  fabric_atomic_int32_destroy(&peer->connection_count);
  fabric_mutex_destroy(&peer->listener_mutex);

  // Clean up peer scoring system
  if (peer->scoring_system)
  {
    peer_scoring_cleanup(peer->scoring_system);
    free(peer->scoring_system);
  }

  // Securely zero the entire peer structure before freeing
  if (peer->maintenance_running)
  {
    peer->maintenance_running = false;
    pthread_join(peer->maintenance_thread, NULL);
  }
  fabric_secure_zero(peer, sizeof(Peer));
  free(peer);
}

void peer_disconnect(Peer *peer, int connection_id)
{
  if (!peer)
    return;

  // Check connection ID bounds atomically
  int32_t current_count;
  if (fabric_atomic_int32_get(&peer->connection_count, &current_count) != THREAD_SUCCESS)
  {
    return;
  }

  if (connection_id >= current_count)
    return;

  // Get write lock for connections array
  ThreadError lock_result = fabric_rwlock_wrlock(&peer->connections_rwlock);
  if (lock_result != THREAD_SUCCESS)
  {
    return;
  }

  Connection *conn = &peer->connections[connection_id];

  // Lock connection for disconnect operation
  ThreadError mutex_result = fabric_mutex_lock(&conn->conn_mutex);
  if (mutex_result != THREAD_SUCCESS)
  {
    fabric_rwlock_unlock(&peer->connections_rwlock);
    return;
  }

  // Shutdown and close socket to unblock any blocking I/O in other threads
  if (conn->sock >= 0)
  {
    shutdown(conn->sock, SHUT_RDWR);
    close(conn->sock);
    conn->sock = -1;
  }

  // Free cipher states
  if (conn->send_cipher)
  {
    noise_cipherstate_free(conn->send_cipher);
    conn->send_cipher = NULL;
  }

  if (conn->recv_cipher)
  {
    noise_cipherstate_free(conn->recv_cipher);
    conn->recv_cipher = NULL;
  }

  // Copy peer_id before modifying connection
  char peer_id_copy[sizeof(conn->peer_id)];
  strncpy(peer_id_copy, conn->peer_id, sizeof(peer_id_copy) - 1);
  peer_id_copy[sizeof(peer_id_copy) - 1] = '\0';

  // Unlock before destroying primitives
  fabric_mutex_unlock(&conn->conn_mutex);
  // Clean up connection thread safety primitives
  fabric_condition_destroy(&conn->conn_condition);
  fabric_mutex_destroy(&conn->conn_mutex);

  // Add disconnect event to the queue
  peer_add_event(peer, peer_id_copy, "unknown", 0, false);

  // Clear the connection slot safely (do not memmove mutex-containing structs)
  memset(conn, 0, sizeof(Connection));
  conn->sock = -1;

  // Decrement connection count atomically
  int32_t new_count;
  fabric_atomic_int32_sub(&peer->connection_count, 1, &new_count);

  // Release write lock
  fabric_rwlock_unlock(&peer->connections_rwlock);
}

static FabricError peer_connect_lightning(Peer *peer, const char *host, int port)
{
  if (!peer)
    return FABRIC_ERROR_PEER_INIT_FAILED;

  // PHASE 2: Validate network inputs
  FabricError validation_result = fabric_validate_ip_address(host);
  if (validation_result != FABRIC_SUCCESS)
  {
    // Try as hostname if IP validation fails
    validation_result = fabric_validate_hostname(host);
    if (validation_result != FABRIC_SUCCESS)
    {
      return FABRIC_ERROR_INVALID_ADDRESS;
    }
  }

  validation_result = fabric_validate_port(port, false); // Don't allow privileged ports
  if (validation_result != FABRIC_SUCCESS)
  {
    return validation_result;
  }

  // Check connection limit atomically
  int32_t current_count;
  if (fabric_atomic_int32_get(&peer->connection_count, &current_count) != THREAD_SUCCESS)
  {
    return FABRIC_ERROR_INTERNAL_STATE_CORRUPTION;
  }

  if (current_count >= PEER_MAX_CONNECTIONS)
    return FABRIC_ERROR_PEER_CONNECTION_LIMIT;

  // Get write lock for connections array
  FABRIC_RWLOCK_WRLOCK_OR(&peer->connections_rwlock, return FABRIC_ERROR_INTERNAL_STATE_CORRUPTION);

  // Find first available connection slot
  int32_t conn_index = -1;
  for (int i = 0; i < PEER_MAX_CONNECTIONS; i++)
  {
    if (peer->connections[i].sock < 0)
    {
      conn_index = i;
      break;
    }
  }

  if (conn_index < 0)
  {
    // No available slots
    FABRIC_RWLOCK_UNLOCK_OR(&peer->connections_rwlock, return FABRIC_ERROR_INTERNAL_STATE_CORRUPTION);
    return FABRIC_ERROR_PEER_CONNECTION_LIMIT;
  }

  Connection *conn = &peer->connections[conn_index];

  // Initialize connection thread safety primitives
  if (fabric_mutex_init(&conn->conn_mutex, "connection_mutex") != THREAD_SUCCESS)
  {
    FABRIC_RWLOCK_UNLOCK_OR(&peer->connections_rwlock, return FABRIC_ERROR_INTERNAL_STATE_CORRUPTION);
    return FABRIC_ERROR_INTERNAL_STATE_CORRUPTION;
  }

  if (fabric_condition_init(&conn->conn_condition, "connection_condition") != THREAD_SUCCESS)
  {
    fabric_mutex_destroy(&conn->conn_mutex);
    FABRIC_RWLOCK_UNLOCK_OR(&peer->connections_rwlock, return FABRIC_ERROR_INTERNAL_STATE_CORRUPTION);
    return FABRIC_ERROR_INTERNAL_STATE_CORRUPTION;
  }

  struct sockaddr_in addr = {
      .sin_family = AF_INET,
      .sin_port = htons(port)};

  if (inet_pton(AF_INET, host, &addr.sin_addr) <= 0)
    return FABRIC_ERROR_INVALID_ADDRESS;

  // Create socket
  conn->sock = socket(AF_INET, SOCK_STREAM, 0);
  if (conn->sock < 0)
    return FABRIC_ERROR_SOCKET_CREATE_FAILED;

#ifdef SO_NOSIGPIPE
  {
    int one = 1;
    setsockopt(conn->sock, SOL_SOCKET, SO_NOSIGPIPE, &one, sizeof(one));
  }
#endif

  // Set socket to non-blocking for connect
  int flags = fcntl(conn->sock, F_GETFL, 0);
  fcntl(conn->sock, F_SETFL, flags | O_NONBLOCK);

  // Connect
  if (connect(conn->sock, (struct sockaddr *)&addr, sizeof(addr)) < 0)
  {
    if (errno != EINPROGRESS)
    {
      perror("connect error");
      close(conn->sock);
      return FABRIC_ERROR_SOCKET_CONNECT_FAILED;
    }

    // Wait for connection to complete
    fd_set write_fds;
    struct timeval timeout;
    FD_ZERO(&write_fds);
    FD_SET(conn->sock, &write_fds);
    timeout.tv_sec = 5; // 5 second timeout
    timeout.tv_usec = 0;

    int select_result = select(conn->sock + 1, NULL, &write_fds, NULL, &timeout);
    if (select_result <= 0)
    {
      fprintf(stderr, "[peer_connect] select timeout or error (rc=%d, errno=%d)\n", select_result, errno);
      close(conn->sock);
      return FABRIC_ERROR_CONNECTION_TIMEOUT;
    }

    // Check if connection was successful
    int error = 0;
    socklen_t len = sizeof(error);
    if (getsockopt(conn->sock, SOL_SOCKET, SO_ERROR, &error, &len) < 0 || error != 0)
    {
      fprintf(stderr, "[peer_connect] SO_ERROR=%d after select\n", error);
      close(conn->sock);
      return FABRIC_ERROR_SOCKET_CONNECT_FAILED;
    }
  }

  // Perform Noise XX handshake via noise.c API
  fcntl(conn->sock, F_SETFL, flags | O_NONBLOCK);
  conn->is_initiator = 1;
  conn->is_lightning = 0;
  if (noise_perform_xx_handshake(conn->sock, 1, peer->app_protocol, peer->private_key, NULL, &conn->send_cipher, &conn->recv_cipher) != 0)
  {
    close(conn->sock);
    FABRIC_RWLOCK_UNLOCK_OR(&peer->connections_rwlock, return FABRIC_ERROR_INTERNAL_STATE_CORRUPTION);
    return FABRIC_ERROR_NOISE_HANDSHAKE_FAILED;
  }

  // Reset socket to blocking
  fcntl(conn->sock, F_SETFL, flags);

  // Increment connection count atomically
  int32_t new_count;
  if (fabric_atomic_int32_add(&peer->connection_count, 1, &new_count) != THREAD_SUCCESS)
  {
    fabric_condition_destroy(&conn->conn_condition);
    fabric_mutex_destroy(&conn->conn_mutex);
    FABRIC_RWLOCK_UNLOCK_OR(&peer->connections_rwlock, return FABRIC_ERROR_INTERNAL_STATE_CORRUPTION);
    return FABRIC_ERROR_INTERNAL_STATE_CORRUPTION;
  }

  // Release write lock
  FABRIC_RWLOCK_UNLOCK_OR(&peer->connections_rwlock, return FABRIC_ERROR_INTERNAL_STATE_CORRUPTION);

  // Initialize connection rate limiter after connection is registered
  {
    FABRIC_MUTEX_LOCK_OR(&conn->conn_mutex, return FABRIC_ERROR_INTERNAL_STATE_CORRUPTION);
    conn->rl_msg_capacity = 20; // 20 msgs/sec
    conn->rl_msg_refill_per_sec = 20;
    conn->rl_msg_tokens = conn->rl_msg_capacity;
    conn->rl_byte_capacity = 64 * 1024; // 64KB/sec
    conn->rl_byte_refill_per_sec = 64 * 1024;
    conn->rl_byte_tokens = conn->rl_byte_capacity;
    conn->rl_last_refill = time(NULL);
    FABRIC_MUTEX_UNLOCK_OR(&conn->conn_mutex, return FABRIC_ERROR_INTERNAL_STATE_CORRUPTION);
  }

  // Send HELLO after successful handshake
  (void)peer_send_hello(peer, conn_index, BITCOIN_MAINNET_MAGIC, 0);

  return FABRIC_SUCCESS;
}

FabricError peer_connect(Peer *peer, const char *host, int port)
{
  // Default: full Fabric Noise XX handshake path
  if (!peer)
    return FABRIC_ERROR_PEER_INIT_FAILED;

  // Validate input
  FabricError validation_result = fabric_validate_ip_address(host);
  if (validation_result != FABRIC_SUCCESS)
  {
    validation_result = fabric_validate_hostname(host);
    if (validation_result != FABRIC_SUCCESS)
    {
      return FABRIC_ERROR_INVALID_ADDRESS;
    }
  }
  validation_result = fabric_validate_port(port, false);
  if (validation_result != FABRIC_SUCCESS) return validation_result;

  // Check connection limit
  int32_t current_count;
  if (fabric_atomic_int32_get(&peer->connection_count, &current_count) != THREAD_SUCCESS)
  {
    return FABRIC_ERROR_INTERNAL_STATE_CORRUPTION;
  }
  if (current_count >= PEER_MAX_CONNECTIONS)
    return FABRIC_ERROR_PEER_CONNECTION_LIMIT;

  // Reserve a slot
  FABRIC_RWLOCK_WRLOCK_OR(&peer->connections_rwlock, return FABRIC_ERROR_INTERNAL_STATE_CORRUPTION);
  int32_t conn_index = -1;
  for (int i = 0; i < PEER_MAX_CONNECTIONS; i++)
  {
    if (peer->connections[i].sock < 0) { conn_index = i; break; }
  }
  if (conn_index < 0)
  {
    FABRIC_RWLOCK_UNLOCK_OR(&peer->connections_rwlock, return FABRIC_ERROR_INTERNAL_STATE_CORRUPTION);
    return FABRIC_ERROR_PEER_CONNECTION_LIMIT;
  }

  Connection *conn = &peer->connections[conn_index];
  if (fabric_mutex_init(&conn->conn_mutex, "connection_mutex") != THREAD_SUCCESS)
  { FABRIC_RWLOCK_UNLOCK_OR(&peer->connections_rwlock, return FABRIC_ERROR_INTERNAL_STATE_CORRUPTION); return FABRIC_ERROR_INTERNAL_STATE_CORRUPTION; }
  if (fabric_condition_init(&conn->conn_condition, "connection_condition") != THREAD_SUCCESS)
  { fabric_mutex_destroy(&conn->conn_mutex); FABRIC_RWLOCK_UNLOCK_OR(&peer->connections_rwlock, return FABRIC_ERROR_INTERNAL_STATE_CORRUPTION); return FABRIC_ERROR_INTERNAL_STATE_CORRUPTION; }

  // Create socket
  struct sockaddr_in addr = { .sin_family = AF_INET, .sin_port = htons(port) };
  if (inet_pton(AF_INET, host, &addr.sin_addr) <= 0) { FABRIC_RWLOCK_UNLOCK_OR(&peer->connections_rwlock, return FABRIC_ERROR_INTERNAL_STATE_CORRUPTION); return FABRIC_ERROR_INVALID_ADDRESS; }
  conn->sock = socket(AF_INET, SOCK_STREAM, 0);
  if (conn->sock < 0) { FABRIC_RWLOCK_UNLOCK_OR(&peer->connections_rwlock, return FABRIC_ERROR_INTERNAL_STATE_CORRUPTION); return FABRIC_ERROR_SOCKET_CREATE_FAILED; }

#ifdef SO_NOSIGPIPE
  { int one = 1; setsockopt(conn->sock, SOL_SOCKET, SO_NOSIGPIPE, &one, sizeof(one)); }
#endif

  // Non-blocking connect
  int flags = fcntl(conn->sock, F_GETFL, 0);
  fcntl(conn->sock, F_SETFL, flags | O_NONBLOCK);
  if (connect(conn->sock, (struct sockaddr *)&addr, sizeof(addr)) < 0)
  {
    if (errno != EINPROGRESS)
    { close(conn->sock); FABRIC_RWLOCK_UNLOCK_OR(&peer->connections_rwlock, return FABRIC_ERROR_INTERNAL_STATE_CORRUPTION); return FABRIC_ERROR_SOCKET_CONNECT_FAILED; }
    fd_set write_fds; struct timeval timeout; FD_ZERO(&write_fds); FD_SET(conn->sock, &write_fds);
    timeout.tv_sec = 5; timeout.tv_usec = 0;
    int sel = select(conn->sock + 1, NULL, &write_fds, NULL, &timeout);
    if (sel <= 0) { close(conn->sock); FABRIC_RWLOCK_UNLOCK_OR(&peer->connections_rwlock, return FABRIC_ERROR_INTERNAL_STATE_CORRUPTION); return FABRIC_ERROR_CONNECTION_TIMEOUT; }
    int error = 0; socklen_t elen = sizeof(error);
    if (getsockopt(conn->sock, SOL_SOCKET, SO_ERROR, &error, &elen) < 0 || error != 0)
    { close(conn->sock); FABRIC_RWLOCK_UNLOCK_OR(&peer->connections_rwlock, return FABRIC_ERROR_INTERNAL_STATE_CORRUPTION); return FABRIC_ERROR_SOCKET_CONNECT_FAILED; }
  }



  // Perform Noise XX handshake via noise.c API
  fcntl(conn->sock, F_SETFL, flags | O_NONBLOCK);
  conn->is_initiator = 1; conn->is_lightning = 0;
  if (noise_perform_xx_handshake(conn->sock, 1, peer->app_protocol, peer->private_key, NULL, &conn->send_cipher, &conn->recv_cipher) != 0)
  { close(conn->sock); FABRIC_RWLOCK_UNLOCK_OR(&peer->connections_rwlock, return FABRIC_ERROR_INTERNAL_STATE_CORRUPTION); return FABRIC_ERROR_NOISE_HANDSHAKE_FAILED; }
  fcntl(conn->sock, F_SETFL, flags);

  // Register connection
  int32_t new_count;
  if (fabric_atomic_int32_add(&peer->connection_count, 1, &new_count) != THREAD_SUCCESS)
  {
    fabric_condition_destroy(&conn->conn_condition);
    fabric_mutex_destroy(&conn->conn_mutex);
    FABRIC_RWLOCK_UNLOCK_OR(&peer->connections_rwlock, return FABRIC_ERROR_INTERNAL_STATE_CORRUPTION);
    return FABRIC_ERROR_INTERNAL_STATE_CORRUPTION;
  }
  FABRIC_RWLOCK_UNLOCK_OR(&peer->connections_rwlock, return FABRIC_ERROR_INTERNAL_STATE_CORRUPTION);

  // Init rate limiter
  {
    FABRIC_MUTEX_LOCK_OR(&conn->conn_mutex, return FABRIC_ERROR_INTERNAL_STATE_CORRUPTION);
    conn->rl_msg_capacity = 20;
    conn->rl_msg_refill_per_sec = 20;
    conn->rl_msg_tokens = conn->rl_msg_capacity;
    conn->rl_byte_capacity = 64 * 1024;
    conn->rl_byte_refill_per_sec = 64 * 1024;
    conn->rl_byte_tokens = conn->rl_byte_capacity;
    conn->rl_last_refill = time(NULL);
    FABRIC_MUTEX_UNLOCK_OR(&conn->conn_mutex, return FABRIC_ERROR_INTERNAL_STATE_CORRUPTION);
  }

  // Send HELLO after handshake
  (void)peer_send_hello(peer, conn_index, BITCOIN_MAINNET_MAGIC, 0);
  return FABRIC_SUCCESS;
}

FabricError peer_connect_with_mode(Peer *peer, const char *host, int port, PeerMode mode)
{
  if (mode == PEER_MODE_LIGHTNING)
  {
    // Lightning uses Noise (BOLT 8). Hook up a dedicated handshake (to be integrated with local copy in ~/lightning).
    return peer_connect_lightning(peer, host, port);
  }
  return peer_connect(peer, host, port);
}

FabricError peer_accept(Peer *peer, int port)
{
  if (!peer)
    return FABRIC_ERROR_PEER_INIT_FAILED;

  // Check connection limit atomically
  int32_t current_count;
  if (fabric_atomic_int32_get(&peer->connection_count, &current_count) != THREAD_SUCCESS)
  {
    return FABRIC_ERROR_INTERNAL_STATE_CORRUPTION;
  }

  if (current_count >= PEER_MAX_CONNECTIONS)
    return FABRIC_ERROR_PEER_CONNECTION_LIMIT;

  // Create listening socket
  int server_sock = socket(AF_INET, SOCK_STREAM, 0);
  if (server_sock < 0)
    return FABRIC_ERROR_SOCKET_CREATE_FAILED;

  // Enable address reuse
  int opt = 1;
  if (setsockopt(server_sock, SOL_SOCKET, SO_REUSEADDR, &opt, sizeof(opt)) < 0)
  {
    close(server_sock);
    return FABRIC_ERROR_SOCKET_BIND_FAILED;
  }

  // Enable port reuse
  if (setsockopt(server_sock, SOL_SOCKET, SO_REUSEPORT, &opt, sizeof(opt)) < 0)
  {
    // SO_REUSEPORT might not be available on all systems, continue anyway
  }

  // Bind to port
  struct sockaddr_in addr = {
      .sin_family = AF_INET,
      .sin_addr.s_addr = htonl(INADDR_ANY),
      .sin_port = htons(port)};

  if (bind(server_sock, (struct sockaddr *)&addr, sizeof(addr)) < 0)
  {
    close(server_sock);
    return FABRIC_ERROR_SOCKET_BIND_FAILED;
  }

  // Listen for connections
  if (listen(server_sock, 1) < 0)
  {
    close(server_sock);
    return FABRIC_ERROR_SOCKET_ACCEPT_FAILED;
  }

  // Set socket to non-blocking for accept
  int flags = fcntl(server_sock, F_GETFL, 0);
  fcntl(server_sock, F_SETFL, flags | O_NONBLOCK);

  // Get write lock for connections array
  FABRIC_RWLOCK_WRLOCK_OR(&peer->connections_rwlock, return FABRIC_ERROR_INTERNAL_STATE_CORRUPTION);

  int32_t conn_index;
  if (fabric_atomic_int32_get(&peer->connection_count, &conn_index) != THREAD_SUCCESS)
  {
    FABRIC_RWLOCK_UNLOCK_OR(&peer->connections_rwlock, return FABRIC_ERROR_INTERNAL_STATE_CORRUPTION);
    return FABRIC_ERROR_INTERNAL_STATE_CORRUPTION;
  }

  Connection *conn = &peer->connections[conn_index];

  // Initialize connection thread safety primitives
  if (fabric_mutex_init(&conn->conn_mutex, "connection_mutex") != THREAD_SUCCESS)
  {
    FABRIC_RWLOCK_UNLOCK_OR(&peer->connections_rwlock, return FABRIC_ERROR_INTERNAL_STATE_CORRUPTION);
    return FABRIC_ERROR_INTERNAL_STATE_CORRUPTION;
  }

  if (fabric_condition_init(&conn->conn_condition, "connection_condition") != THREAD_SUCCESS)
  {
    fabric_mutex_destroy(&conn->conn_mutex);
    FABRIC_RWLOCK_UNLOCK_OR(&peer->connections_rwlock, return FABRIC_ERROR_INTERNAL_STATE_CORRUPTION);
    return FABRIC_ERROR_INTERNAL_STATE_CORRUPTION;
  }

  struct sockaddr_in client_addr;
  socklen_t addr_len = sizeof(client_addr);
  int accept_timeout = 100; // 100 attempts

  while (accept_timeout > 0)
  {
    conn->sock = accept(server_sock, (struct sockaddr *)&client_addr, &addr_len);
    if (conn->sock >= 0)
      break;

    if (errno != EAGAIN && errno != EWOULDBLOCK)
    {
      close(server_sock);
      return FABRIC_ERROR_SOCKET_ACCEPT_FAILED;
    }

    usleep(1000); // 1ms delay
    accept_timeout--;
  }

  close(server_sock);

  if (conn->sock < 0)
  {
    return FABRIC_ERROR_CONNECTION_TIMEOUT;
  }

  // Set socket to non-blocking for handshake
  flags = fcntl(conn->sock, F_GETFL, 0);
  fcntl(conn->sock, F_SETFL, flags | O_NONBLOCK);

  // Perform handshake as responder
  conn->is_initiator = 0;

  if (noise_perform_xx_handshake(conn->sock, 0, peer->app_protocol, peer->private_key, NULL, &conn->send_cipher, &conn->recv_cipher) != 0)
  {
    fabric_condition_destroy(&conn->conn_condition);
    fabric_mutex_destroy(&conn->conn_mutex);
    fabric_rwlock_unlock(&peer->connections_rwlock);
    close(conn->sock);
    goto continue_loop;
  }

  // Reset socket to blocking
  fcntl(conn->sock, F_SETFL, flags);

  // Increment connection count atomically
  int32_t new_count;
  if (fabric_atomic_int32_add(&peer->connection_count, 1, &new_count) != THREAD_SUCCESS)
  {
    // Cleanup on failure
    fabric_condition_destroy(&conn->conn_condition);
    fabric_mutex_destroy(&conn->conn_mutex);
    FABRIC_RWLOCK_UNLOCK_OR(&peer->connections_rwlock, return FABRIC_ERROR_INTERNAL_STATE_CORRUPTION);
    close(conn->sock);
    goto continue_loop;
  }

  // Release write lock
  FABRIC_RWLOCK_UNLOCK_OR(&peer->connections_rwlock, return FABRIC_ERROR_INTERNAL_STATE_CORRUPTION);

  // Initialize connection rate limiter after connection is registered
  {
    FABRIC_MUTEX_LOCK_OR(&conn->conn_mutex, return FABRIC_ERROR_INTERNAL_STATE_CORRUPTION);
    conn->rl_msg_capacity = 20; // 20 msgs/sec
    conn->rl_msg_refill_per_sec = 20;
    conn->rl_msg_tokens = conn->rl_msg_capacity;
    conn->rl_byte_capacity = 64 * 1024; // 64KB/sec
    conn->rl_byte_refill_per_sec = 64 * 1024;
    conn->rl_byte_tokens = conn->rl_byte_capacity;
    conn->rl_last_refill = time(NULL);
    FABRIC_MUTEX_UNLOCK_OR(&conn->conn_mutex, return FABRIC_ERROR_INTERNAL_STATE_CORRUPTION);
  }

  // Send HELLO after successful handshake (responder)
  (void)peer_send_hello(peer, new_count - 1, BITCOIN_MAINNET_MAGIC, 0);

  return FABRIC_SUCCESS;

continue_loop:
  ; // label target
  return FABRIC_ERROR_CONNECTION_TIMEOUT;
}

FabricError peer_generate_keypair(Peer *peer)
{
  if (!peer || !peer->secp256k1_ctx)
    return FABRIC_ERROR_PEER_INIT_FAILED;

  // Create new keypair using secp256k1
  secp256k1_keypair keypair;
  uint8_t seckey[32];

  // SECURITY: Use cryptographically secure random generation
  FabricError rand_result = fabric_secure_random_bytes(seckey, 32);
  if (rand_result != FABRIC_SUCCESS)
  {
    fabric_secure_zero(seckey, 32);
    return rand_result;
  }

  // Ensure it's a valid secp256k1 private key
  if (secp256k1_ec_seckey_verify(peer->secp256k1_ctx, seckey) != 1)
  {
    fabric_secure_zero(seckey, 32);
    return FABRIC_ERROR_INVALID_KEY;
  }

  // Create keypair
  if (secp256k1_keypair_create(peer->secp256k1_ctx, &keypair, seckey) != 1)
  {
    fabric_secure_zero(seckey, 32);
    return FABRIC_ERROR_KEY_GENERATION_FAILED;
  }

  // Get public key
  secp256k1_pubkey pubkey;
  if (secp256k1_keypair_pub(peer->secp256k1_ctx, &pubkey, &keypair) != 1)
  {
    fabric_secure_zero(seckey, 32);
    return FABRIC_ERROR_KEY_GENERATION_FAILED;
  }

  // Serialize public key to compressed format (33 bytes)
  size_t pubkey_len = 33;
  if (secp256k1_ec_pubkey_serialize(peer->secp256k1_ctx, peer->public_key, &pubkey_len, &pubkey, SECP256K1_EC_COMPRESSED) != 1)
  {
    fabric_secure_zero(seckey, 32);
    return FABRIC_ERROR_KEY_GENERATION_FAILED;
  }

  // Copy private key and securely zero the temporary copy
  memcpy(peer->private_key, seckey, 32);
  fabric_secure_zero(seckey, 32);

  return FABRIC_SUCCESS;
}

FabricError peer_send_message(Peer *peer, int connection_id, const Message *message)
{
  if (!peer || !message)
    return FABRIC_ERROR_PEER_INIT_FAILED;

  // Validate slot index and socket
  if (connection_id < 0 || connection_id >= PEER_MAX_CONNECTIONS)
    return FABRIC_ERROR_PEER_INVALID_CONNECTION;

  // Get read lock for connections array
  FABRIC_RWLOCK_RDLOCK_OR(&peer->connections_rwlock, return FABRIC_ERROR_INTERNAL_STATE_CORRUPTION);

  Connection *conn = &peer->connections[connection_id];
  if (conn->sock < 0)
  {
    FABRIC_RWLOCK_UNLOCK_OR(&peer->connections_rwlock, return FABRIC_ERROR_INTERNAL_STATE_CORRUPTION);
    return FABRIC_ERROR_PEER_INVALID_CONNECTION;
  }

  // Lock connection for send operation
  FABRIC_MUTEX_LOCK_OR(&conn->conn_mutex, return FABRIC_ERROR_INTERNAL_STATE_CORRUPTION);

  // Rate limit check and refill
  time_t now = time(NULL);
  if (conn->rl_last_refill != 0 && now > conn->rl_last_refill)
  {
    time_t elapsed = now - conn->rl_last_refill;
    uint64_t add_msg = (uint64_t)elapsed * conn->rl_msg_refill_per_sec;
    uint64_t add_bytes = (uint64_t)elapsed * conn->rl_byte_refill_per_sec;
    conn->rl_msg_tokens = (uint32_t)((conn->rl_msg_tokens + add_msg > conn->rl_msg_capacity) ? conn->rl_msg_capacity : (conn->rl_msg_tokens + add_msg));
    conn->rl_byte_tokens = (uint32_t)((conn->rl_byte_tokens + add_bytes > conn->rl_byte_capacity) ? conn->rl_byte_capacity : (conn->rl_byte_tokens + add_bytes));
    conn->rl_last_refill = now;
  }

  uint8_t buffer[PEER_BUFFER_SIZE];
  size_t message_size = sizeof(Message) - sizeof(uint8_t *) + message->size;

  // Enforce per-connection byte/token limits
  if (message_size > conn->rl_byte_tokens || conn->rl_msg_tokens == 0)
  {
    FABRIC_MUTEX_UNLOCK_OR(&conn->conn_mutex, return FABRIC_ERROR_INTERNAL_STATE_CORRUPTION);
    FABRIC_RWLOCK_UNLOCK_OR(&peer->connections_rwlock, return FABRIC_ERROR_INTERNAL_STATE_CORRUPTION);
    return FABRIC_ERROR_RESOURCE_UNAVAILABLE;
  }

  // Serialize header via protocol helper (BE magic)
  size_t header_size = protocol_serialize_header(message, buffer, sizeof(buffer));
  if (header_size == 0) {
    FABRIC_MUTEX_UNLOCK_OR(&conn->conn_mutex, return FABRIC_ERROR_INTERNAL_STATE_CORRUPTION);
    FABRIC_RWLOCK_UNLOCK_OR(&peer->connections_rwlock, return FABRIC_ERROR_INTERNAL_STATE_CORRUPTION);
    return FABRIC_ERROR_MESSAGE_SERIALIZATION_FAILED;
  }
  // Enforce body hash is present and correct before sending
  if (message_verify_body_hash(message) != FABRIC_SUCCESS)
  {
    printf("[fabricd] abort send: invalid body hash on conn %d\n", connection_id);
    FABRIC_MUTEX_UNLOCK_OR(&conn->conn_mutex, return FABRIC_ERROR_INTERNAL_STATE_CORRUPTION);
    FABRIC_RWLOCK_UNLOCK_OR(&peer->connections_rwlock, return FABRIC_ERROR_INTERNAL_STATE_CORRUPTION);
    return FABRIC_ERROR_VERIFICATION_FAILED;
  }
  // Enforce signature present and valid
  if (peer->secp256k1_ctx)
  {
    FabricError vr = message_verify(message, peer->secp256k1_ctx);
    if (vr != FABRIC_SUCCESS)
    {
      printf("[fabricd] abort send: unsigned/invalid signature on conn %d\n", connection_id);
      FABRIC_MUTEX_UNLOCK_OR(&conn->conn_mutex, return FABRIC_ERROR_INTERNAL_STATE_CORRUPTION);
      FABRIC_RWLOCK_UNLOCK_OR(&peer->connections_rwlock, return FABRIC_ERROR_INTERNAL_STATE_CORRUPTION);
      return FABRIC_ERROR_INVALID_SIGNATURE;
    }
  }
  if (message->body && message->size > 0)
  {
    memcpy(buffer + header_size, message->body, message->size);
  }

  // Encrypt
  NoiseBuffer noise_buffer;
  noise_buffer.data = buffer;
  noise_buffer.size = message_size;
  noise_buffer.max_size = sizeof(buffer);

  if (noise_cipherstate_encrypt(conn->send_cipher, &noise_buffer) != NOISE_ERROR_NONE)
  {
    return FABRIC_ERROR_NOISE_WRITE_FAILED;
  }

  // Add retry logic to send function
  int retries = 3;
  while (retries > 0)
  {
    ssize_t sent = send(conn->sock, noise_buffer.data, noise_buffer.size, MSG_NOSIGNAL);
    if (sent > 0 && (size_t)sent == noise_buffer.size)
    {
      // Consume tokens on success
      if (conn->rl_msg_tokens > 0) conn->rl_msg_tokens--;
      if (conn->rl_byte_tokens >= noise_buffer.size) conn->rl_byte_tokens -= (uint32_t)noise_buffer.size;
      // Unlock connection and release read lock
      FABRIC_MUTEX_UNLOCK_OR(&conn->conn_mutex, return FABRIC_ERROR_INTERNAL_STATE_CORRUPTION);
      FABRIC_RWLOCK_UNLOCK_OR(&peer->connections_rwlock, return FABRIC_ERROR_INTERNAL_STATE_CORRUPTION);
      return FABRIC_SUCCESS;
    }

    if (errno != EAGAIN && errno != EWOULDBLOCK && errno != EPIPE)
    {
      break;
    }
    if (errno == EPIPE) {
      // Peer closed; no more retries
      break;
    }
    retries--;
    usleep(1000); // 1ms backoff
  }
  // Unlock connection and release read lock on error
  FABRIC_MUTEX_UNLOCK_OR(&conn->conn_mutex, return FABRIC_ERROR_INTERNAL_STATE_CORRUPTION);
  FABRIC_RWLOCK_UNLOCK_OR(&peer->connections_rwlock, return FABRIC_ERROR_INTERNAL_STATE_CORRUPTION);

  return FABRIC_ERROR_SOCKET_SEND_FAILED;
}

FabricError peer_receive_message(Peer *peer, int connection_id, Message *message)
{
  if (!peer || !message)
    return FABRIC_ERROR_PEER_INIT_FAILED;

  // Validate slot index and socket
  if (connection_id < 0 || connection_id >= PEER_MAX_CONNECTIONS)
    return FABRIC_ERROR_PEER_INVALID_CONNECTION;

  // Get read lock for connections array
  FABRIC_RWLOCK_RDLOCK_OR(&peer->connections_rwlock, return FABRIC_ERROR_INTERNAL_STATE_CORRUPTION);

  Connection *conn = &peer->connections[connection_id];
  if (conn->sock < 0)
  {
    FABRIC_RWLOCK_UNLOCK_OR(&peer->connections_rwlock, return FABRIC_ERROR_INTERNAL_STATE_CORRUPTION);
    return FABRIC_ERROR_PEER_INVALID_CONNECTION;
  }

  // Lock connection for receive operation
  FABRIC_MUTEX_LOCK_OR(&conn->conn_mutex, return FABRIC_ERROR_INTERNAL_STATE_CORRUPTION);

  // Rate limit: refill tokens
  time_t now = time(NULL);
  if (conn->rl_last_refill != 0 && now > conn->rl_last_refill)
  {
    time_t elapsed = now - conn->rl_last_refill;
    uint64_t add_msg = (uint64_t)elapsed * conn->rl_msg_refill_per_sec;
    uint64_t add_bytes = (uint64_t)elapsed * conn->rl_byte_refill_per_sec;
    conn->rl_msg_tokens = (uint32_t)((conn->rl_msg_tokens + add_msg > conn->rl_msg_capacity) ? conn->rl_msg_capacity : (conn->rl_msg_tokens + add_msg));
    conn->rl_byte_tokens = (uint32_t)((conn->rl_byte_tokens + add_bytes > conn->rl_byte_capacity) ? conn->rl_byte_capacity : (conn->rl_byte_tokens + add_bytes));
    conn->rl_last_refill = now;
  }

  uint8_t buffer[PEER_BUFFER_SIZE];

  // Set socket to non-blocking for receive with timeout
  int flags = fcntl(conn->sock, F_GETFL, 0);
  fcntl(conn->sock, F_SETFL, flags | O_NONBLOCK);

  // Add retry logic to receive function with timeout
  int retries = 10; // More retries for timeout
  while (retries > 0)
  {
    ssize_t received = recv(conn->sock, buffer, sizeof(buffer), 0);
    if (received > 0)
    {
      // Setup noise buffer for decryption
      NoiseBuffer noise_buffer;
      noise_buffer.data = buffer;
      noise_buffer.size = (size_t)received;
      noise_buffer.max_size = sizeof(buffer);

      // Decrypt the message
      int nd = noise_cipherstate_decrypt(conn->recv_cipher, &noise_buffer);
      if (nd != NOISE_ERROR_NONE)
      {
        printf("[fabricd] decrypt failed (%d) on conn %d\n", nd, connection_id);
        return FABRIC_ERROR_NOISE_READ_FAILED;
      }

      // Deserialize the message header
      if (noise_buffer.size < sizeof(Message) - sizeof(uint8_t *))
      {
        FABRIC_MUTEX_UNLOCK_OR(&conn->conn_mutex, return FABRIC_ERROR_INTERNAL_STATE_CORRUPTION);
        FABRIC_RWLOCK_UNLOCK_OR(&peer->connections_rwlock, return FABRIC_ERROR_INTERNAL_STATE_CORRUPTION);
        printf("[fabricd] protocol violation: short header from conn %d\n", connection_id);
        peer_flag_and_disconnect(peer, connection_id, PEER_BEHAVIOR_PROTOCOL_VIOLATION, "short header");
        return FABRIC_ERROR_MESSAGE_INVALID_FORMAT;
      }
      // Parse header via protocol helper
      FabricError ph = protocol_parse_header(buffer, noise_buffer.size, message);
      if (ph != FABRIC_SUCCESS)
      {
        FABRIC_MUTEX_UNLOCK_OR(&conn->conn_mutex, return FABRIC_ERROR_INTERNAL_STATE_CORRUPTION);
        FABRIC_RWLOCK_UNLOCK_OR(&peer->connections_rwlock, return FABRIC_ERROR_INTERNAL_STATE_CORRUPTION);
        peer_flag_and_disconnect(peer, connection_id, PEER_BEHAVIOR_PROTOCOL_VIOLATION, "bad header");
        return ph;
      }

      // Verify message size (defensive bounds)
      size_t body_offset = sizeof(Message) - sizeof(uint8_t *);
      if (message->size > MESSAGE_BODY_SIZE_MAX)
      {
        FABRIC_MUTEX_UNLOCK_OR(&conn->conn_mutex, return FABRIC_ERROR_INTERNAL_STATE_CORRUPTION);
        FABRIC_RWLOCK_UNLOCK_OR(&peer->connections_rwlock, return FABRIC_ERROR_INTERNAL_STATE_CORRUPTION);
        printf("[fabricd] protocol violation: oversize body %u from conn %d\n", message->size, connection_id);
        peer_flag_and_disconnect(peer, connection_id, PEER_BEHAVIOR_PROTOCOL_VIOLATION, "oversize body");
        return FABRIC_ERROR_MESSAGE_TOO_LARGE;
      }
      if (message->size > 0)
      {
        if (noise_buffer.size < body_offset + message->size)
        {
          FABRIC_MUTEX_UNLOCK_OR(&conn->conn_mutex, return FABRIC_ERROR_INTERNAL_STATE_CORRUPTION);
          FABRIC_RWLOCK_UNLOCK_OR(&peer->connections_rwlock, return FABRIC_ERROR_INTERNAL_STATE_CORRUPTION);
          printf("[fabricd] protocol violation: truncated body from conn %d\n", connection_id);
          peer_flag_and_disconnect(peer, connection_id, PEER_BEHAVIOR_PROTOCOL_VIOLATION, "truncated body");
          return FABRIC_ERROR_MESSAGE_INVALID_FORMAT;
        }
        // Rate limit: ensure we have tokens to accept this message
        if (conn->rl_msg_tokens == 0 || conn->rl_byte_tokens < (body_offset + message->size))
        {
          FABRIC_MUTEX_UNLOCK_OR(&conn->conn_mutex, return FABRIC_ERROR_INTERNAL_STATE_CORRUPTION);
          FABRIC_RWLOCK_UNLOCK_OR(&peer->connections_rwlock, return FABRIC_ERROR_INTERNAL_STATE_CORRUPTION);
          printf("[fabricd] spam detected: rate limit exceeded on conn %d\n", connection_id);
          peer_flag_and_disconnect(peer, connection_id, PEER_BEHAVIOR_SPAM_DETECTED, "rate limit exceeded");
          return FABRIC_ERROR_RESOURCE_UNAVAILABLE;
        }
        // Allocate and copy body
        message->body = malloc(message->size);
        if (!message->body)
        {
          return FABRIC_ERROR_OUT_OF_MEMORY;
        }
        memcpy(message->body, buffer + body_offset, message->size);
        // Verify body hash matches; penalize on mismatch
        if (message_verify_body_hash(message) != FABRIC_SUCCESS)
        {
          FABRIC_MUTEX_UNLOCK_OR(&conn->conn_mutex, return FABRIC_ERROR_INTERNAL_STATE_CORRUPTION);
          FABRIC_RWLOCK_UNLOCK_OR(&peer->connections_rwlock, return FABRIC_ERROR_INTERNAL_STATE_CORRUPTION);
          printf("[fabricd] protocol violation: bad body hash on conn %d\n", connection_id);
          peer_flag_and_disconnect(peer, connection_id, PEER_BEHAVIOR_PROTOCOL_VIOLATION, "bad body hash");
          return FABRIC_ERROR_VERIFICATION_FAILED;
        }
        // Enforce signature validity; penalize on failure
        if (peer->secp256k1_ctx && message_verify(message, peer->secp256k1_ctx) != FABRIC_SUCCESS)
        {
          FABRIC_MUTEX_UNLOCK_OR(&conn->conn_mutex, return FABRIC_ERROR_INTERNAL_STATE_CORRUPTION);
          FABRIC_RWLOCK_UNLOCK_OR(&peer->connections_rwlock, return FABRIC_ERROR_INTERNAL_STATE_CORRUPTION);
          printf("[fabricd] protocol violation: unsigned/invalid signature on conn %d\n", connection_id);
          peer_flag_and_disconnect(peer, connection_id, PEER_BEHAVIOR_PROTOCOL_VIOLATION, "invalid signature");
          return FABRIC_ERROR_INVALID_SIGNATURE;
        }
        // Consume tokens (header+body as received)
        if (conn->rl_msg_tokens > 0) conn->rl_msg_tokens--;
        size_t consumed = noise_buffer.size; // encrypted size approx; use received length
        if (conn->rl_byte_tokens >= consumed) conn->rl_byte_tokens -= (uint32_t)consumed;
      }
      else
      {
        message->body = NULL;
      }

      // Unlock connection and release read lock on success
      FABRIC_MUTEX_UNLOCK_OR(&conn->conn_mutex, return FABRIC_ERROR_INTERNAL_STATE_CORRUPTION);
      FABRIC_RWLOCK_UNLOCK_OR(&peer->connections_rwlock, return FABRIC_ERROR_INTERNAL_STATE_CORRUPTION);

      return FABRIC_SUCCESS;
    }
    if (errno != EAGAIN && errno != EWOULDBLOCK)
    {
      break;
    }
    retries--;
    usleep(100000); // 100ms backoff for timeout
  }

  // Restore socket to blocking mode
  fcntl(conn->sock, F_SETFL, flags);

  // Unlock connection and release read lock on error
  FABRIC_MUTEX_UNLOCK_OR(&conn->conn_mutex, return FABRIC_ERROR_INTERNAL_STATE_CORRUPTION);
  FABRIC_RWLOCK_UNLOCK_OR(&peer->connections_rwlock, return FABRIC_ERROR_INTERNAL_STATE_CORRUPTION);

  return FABRIC_ERROR_SOCKET_RECV_FAILED;
}

// Receive messages, auto-handle basic protocol, and return only application messages
FabricError peer_receive_next_app_message(Peer *peer, int connection_id, Message *out_message)
{
  if (!peer || !out_message) return FABRIC_ERROR_PEER_INIT_FAILED;

  // Loop, draining protocol-level messages
  for (int i = 0; i < 16; i++)
  {
    Message tmp = {0};
    FabricError r = peer_receive_message(peer, connection_id, &tmp);
    if (r != FABRIC_SUCCESS) return r;

    // Basic protocol types
    if (tmp.type == PROTOCOL_HELLO || tmp.type == PROTOCOL_PING || tmp.type == PROTOCOL_PONG)
    {
      (void)peer_handle_basic_protocol(peer, connection_id, &tmp);
      if (tmp.body) free(tmp.body);
      continue; // keep draining until an app message appears
    }

    // Deliver application message to caller
    *out_message = tmp;
    return FABRIC_SUCCESS;
  }
  return FABRIC_ERROR_TIMEOUT;
}

FabricError peer_set_timeout(Peer *peer, int timeout_seconds)
{
  if (!peer)
    return FABRIC_ERROR_PEER_INIT_FAILED;

  // Check connection count atomically
  int32_t current_count;
  if (fabric_atomic_int32_get(&peer->connection_count, &current_count) != THREAD_SUCCESS)
  {
    return FABRIC_ERROR_INTERNAL_STATE_CORRUPTION;
  }

  if (current_count < 1)
    return FABRIC_ERROR_PEER_INVALID_CONNECTION;

  struct timeval tv;
  tv.tv_sec = timeout_seconds;
  tv.tv_usec = 0;

  // Get read lock for connections array
  FABRIC_RWLOCK_RDLOCK_OR(&peer->connections_rwlock, return FABRIC_ERROR_INTERNAL_STATE_CORRUPTION);

  Connection *conn = &peer->connections[current_count - 1];

  // Lock connection for timeout operation
  FABRIC_MUTEX_LOCK_OR(&conn->conn_mutex, return FABRIC_ERROR_INTERNAL_STATE_CORRUPTION);

  // Set receive timeout
  if (setsockopt(conn->sock, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof(tv)) < 0)
  {
    return FABRIC_ERROR_SYSTEM_CALL_FAILED;
  }

  // Set send timeout
  if (setsockopt(conn->sock, SOL_SOCKET, SO_SNDTIMEO, &tv, sizeof(tv)) < 0)
  {
    return FABRIC_ERROR_SYSTEM_CALL_FAILED;
  }

  // Set TCP keepalive
  int keepalive = 1;
  if (setsockopt(conn->sock, SOL_SOCKET, SO_KEEPALIVE, &keepalive, sizeof(keepalive)) < 0)
  {
    return FABRIC_ERROR_SYSTEM_CALL_FAILED;
  }

#ifdef __APPLE__
  // macOS specific keepalive options
  int keepintvl = 1;
  if (setsockopt(conn->sock, IPPROTO_TCP, TCP_KEEPALIVE, &keepintvl, sizeof(keepintvl)) < 0)
  {
    return FABRIC_ERROR_SYSTEM_CALL_FAILED;
  }
#else
  // Linux specific keepalive options
  int keepcnt = 3;
  int keepidle = 1;
  int keepintvl = 1;

  if (setsockopt(conn->sock, IPPROTO_TCP, TCP_KEEPCNT, &keepcnt, sizeof(keepcnt)) < 0 ||
      setsockopt(conn->sock, IPPROTO_TCP, TCP_KEEPIDLE, &keepidle, sizeof(keepidle)) < 0 ||
      setsockopt(conn->sock, IPPROTO_TCP, TCP_KEEPINTVL, &keepintvl, sizeof(keepintvl)) < 0)
  {
    return FABRIC_ERROR_SYSTEM_CALL_FAILED;
  }
#endif

  // Unlock connection and release read lock
  FABRIC_MUTEX_UNLOCK_OR(&conn->conn_mutex, return FABRIC_ERROR_INTERNAL_STATE_CORRUPTION);
  FABRIC_RWLOCK_UNLOCK_OR(&peer->connections_rwlock, return FABRIC_ERROR_INTERNAL_STATE_CORRUPTION);

  return FABRIC_SUCCESS;
}

FabricError peer_send_hello(Peer *peer, int connection_id, uint32_t network_magic, uint32_t features)
{
  if (!peer) return FABRIC_ERROR_PEER_INIT_FAILED;
  Message *msg = message_create();
  if (!msg) return FABRIC_ERROR_OUT_OF_MEMORY;
  uint8_t node_id[32] = {0};
  memcpy(node_id, peer->public_key + (33 - 32), 32);
  FabricError r = protocol_build_hello(msg, node_id, network_magic, features);
  if (r == FABRIC_SUCCESS) r = peer_send_message(peer, connection_id, msg);
  message_destroy(msg);
  return r;
}

FabricError peer_send_ping(Peer *peer, int connection_id, uint64_t nonce)
{
  if (!peer) return FABRIC_ERROR_PEER_INIT_FAILED;
  Message *msg = message_create();
  if (!msg) return FABRIC_ERROR_OUT_OF_MEMORY;
  FabricError r = protocol_build_ping(msg, nonce);
  if (r == FABRIC_SUCCESS) r = peer_send_message(peer, connection_id, msg);
  message_destroy(msg);
  return r;
}

FabricError peer_send_pong(Peer *peer, int connection_id, uint64_t nonce)
{
  if (!peer) return FABRIC_ERROR_PEER_INIT_FAILED;
  Message *msg = message_create();
  if (!msg) return FABRIC_ERROR_OUT_OF_MEMORY;
  FabricError r = protocol_build_pong(msg, nonce);
  if (r == FABRIC_SUCCESS) r = peer_send_message(peer, connection_id, msg);
  message_destroy(msg);
  return r;
}

FabricError peer_handle_basic_protocol(Peer *peer, int connection_id, const Message *incoming)
{
  if (!peer || !incoming) return FABRIC_ERROR_INVALID_INPUT;

  if (incoming->type == PROTOCOL_PING)
  {
    uint64_t nonce = 0;
    if (protocol_parse_ping(incoming, &nonce) != FABRIC_SUCCESS) {
      peer_flag_and_disconnect(peer, connection_id, PEER_BEHAVIOR_PROTOCOL_VIOLATION, "bad ping");
      return FABRIC_ERROR_MESSAGE_INVALID_FORMAT;
    }
    return peer_send_pong(peer, connection_id, nonce);
  }
  if (incoming->type == PROTOCOL_HELLO)
  {
    // For now, just acknowledge; future: store peer features
    return FABRIC_SUCCESS;
  }
  if (incoming->type == PROTOCOL_PONG)
  {
    return FABRIC_SUCCESS;
  }
  return FABRIC_ERROR_UNSUPPORTED_MESSAGE_TYPE;
}

// Peer scoring integration functions

FabricError peer_init_scoring(Peer *peer, uint32_t max_peers)
{
  FABRIC_CHECK_NULL(peer);

  // Initialize peer scoring system
  peer->scoring_system = malloc(sizeof(PeerScoringSystem));
  if (!peer->scoring_system)
  {
    return FABRIC_ERROR_OUT_OF_MEMORY;
  }

  FabricError result = peer_scoring_init(peer->scoring_system, max_peers);
  if (result != FABRIC_SUCCESS)
  {
    free(peer->scoring_system);
    peer->scoring_system = NULL;
    return result;
  }

  // Generate local peer ID from public key
  snprintf(peer->local_peer_id, sizeof(peer->local_peer_id),
           "peer_%02x%02x%02x%02x",
           peer->public_key[1], peer->public_key[2],
           peer->public_key[3], peer->public_key[4]);

  return FABRIC_SUCCESS;
}

FabricError peer_record_behavior(Peer *peer, const char *peer_id, PeerBehaviorType behavior,
                                 const char *description)
{
  FABRIC_CHECK_NULL(peer);

  if (!peer->scoring_system)
  {
    return FABRIC_ERROR_PEER_INIT_FAILED;
  }

  // Get default score for behavior type
  int32_t score_change = peer_behavior_get_default_score(behavior);

  return peer_scoring_record_behavior(peer->scoring_system, peer_id, behavior,
                                      score_change, description, NULL);
}

FabricError peer_get_top_peers(Peer *peer, PeerScoringContext **peers, uint32_t max_peers,
                               uint32_t *actual_count)
{
  FABRIC_CHECK_NULL(peer);

  if (!peer->scoring_system)
  {
    return FABRIC_ERROR_PEER_INIT_FAILED;
  }

  return peer_scoring_get_top_peers(peer->scoring_system, peers, max_peers, actual_count);
}

bool peer_is_trusted(Peer *peer, const char *peer_id)
{
  if (!peer || !peer_id || !peer->scoring_system)
  {
    return false;
  }

  return peer_scoring_is_trusted(peer->scoring_system, peer_id);
}

int32_t peer_get_score(Peer *peer, const char *peer_id)
{
  if (!peer || !peer_id || !peer->scoring_system)
  {
    return PEER_SCORE_MIN;
  }

  return peer_scoring_get_score(peer->scoring_system, peer_id);
}

// Listening server functions

// Thread function for accepting incoming connections
static void *listener_thread_function(void *arg)
{
  Peer *peer = (Peer *)arg;

  while (peer->is_listening)
  {
    // Accept incoming connection
    struct sockaddr_in client_addr;
    socklen_t addr_len = sizeof(client_addr);

    int client_sock = accept(peer->listening_socket, (struct sockaddr *)&client_addr, &addr_len);

    if (client_sock < 0)
    {
      // If listener was closed, exit cleanly
      if (!peer->is_listening)
      {
        break;
      }
      // Transient error, log and yield
      perror("Accept error");
      usleep(1000);
      continue;
    }

#ifdef SO_NOSIGPIPE
    {
      int one = 1;
      setsockopt(client_sock, SOL_SOCKET, SO_NOSIGPIPE, &one, sizeof(one));
    }
#endif

    // Set accepted socket to non-blocking
    int cflags = fcntl(client_sock, F_GETFL, 0);
    fcntl(client_sock, F_SETFL, cflags | O_NONBLOCK);

    // Check if we can accept more connections
    int32_t current_count;
    if (fabric_atomic_int32_get(&peer->connection_count, &current_count) != THREAD_SUCCESS)
    {
      close(client_sock);
      continue;
    }

    if (current_count >= PEER_MAX_CONNECTIONS)
    {
      // Connection limit reached, reject
      close(client_sock);
      continue;
    }

    // Get write lock for connections array
    if (fabric_rwlock_wrlock(&peer->connections_rwlock) != THREAD_SUCCESS) {
      close(client_sock);
      continue;
    }

    // Find first available connection slot
    int32_t conn_index = -1;
    for (int i = 0; i < PEER_MAX_CONNECTIONS; i++)
    {
      if (peer->connections[i].sock < 0)
      {
        conn_index = i;
        break;
      }
    }

    if (conn_index < 0)
    {
      // No available slots
      fabric_rwlock_unlock(&peer->connections_rwlock);
      close(client_sock);
      continue;
    }

    Connection *conn = &peer->connections[conn_index];

    // Initialize connection thread safety primitives
    if (fabric_mutex_init(&conn->conn_mutex, "connection_mutex") != THREAD_SUCCESS)
    {
      fabric_rwlock_unlock(&peer->connections_rwlock);
      close(client_sock);
      continue;
    }

    if (fabric_condition_init(&conn->conn_condition, "connection_condition") != THREAD_SUCCESS)
    {
      fabric_mutex_destroy(&conn->conn_mutex);
      fabric_rwlock_unlock(&peer->connections_rwlock);
      close(client_sock);
      continue;
    }

    // Set up the connection
    conn->sock = client_sock;
    conn->is_initiator = 0;
    conn->connection_time = time(NULL);

    // Log accept
    {
      char ipbuf_log[INET_ADDRSTRLEN];
      inet_ntop(AF_INET, &client_addr.sin_addr, ipbuf_log, sizeof(ipbuf_log));
      int port_log = (int)ntohs(client_addr.sin_port);
      printf("[fabricd] accepted connection from %s:%d\n", ipbuf_log, port_log);
    }

    // Get socket flags for later use
    int flags = fcntl(client_sock, F_GETFL, 0);

    // Exchange public keys first (non-blocking receive loop)
    uint8_t remote_pubkey[33];
    size_t received_total = 0;
    int recv_tries = 200;
    while (received_total < 33 && recv_tries-- > 0)
    {
      ssize_t r = recv(client_sock, remote_pubkey + received_total, 33 - received_total, 0);
      if (r > 0)
      {
        received_total += (size_t)r;
        if (received_total == 33) break;
      }
      else if (r == 0)
      {
        fabric_condition_destroy(&conn->conn_condition);
        fabric_mutex_destroy(&conn->conn_mutex);
        fabric_rwlock_unlock(&peer->connections_rwlock);
        close(client_sock);
        goto continue_loop;
      }
      else
      {
        if (errno != EAGAIN && errno != EWOULDBLOCK)
        {
          fabric_condition_destroy(&conn->conn_condition);
          fabric_mutex_destroy(&conn->conn_mutex);
          fabric_rwlock_unlock(&peer->connections_rwlock);
          close(client_sock);
          goto continue_loop;
        }
        usleep(1000);
      }
    }
    if (received_total != 33)
    {
      fabric_condition_destroy(&conn->conn_condition);
      fabric_mutex_destroy(&conn->conn_mutex);
      fabric_rwlock_unlock(&peer->connections_rwlock);
      close(client_sock);
      goto continue_loop;
    }

    // Send our public key with retry for EAGAIN
    {
      size_t sent_total = 0;
      int send_tries = 200;
      while (sent_total < 33 && send_tries-- > 0)
      {
        ssize_t s = send(client_sock, peer->public_key + sent_total, 33 - sent_total, MSG_NOSIGNAL);
        if (s > 0)
        {
          sent_total += (size_t)s;
          if (sent_total == 33) break;
        }
        else if (s == 0)
        {
          break;
        }
        else
        {
          if (errno != EAGAIN && errno != EWOULDBLOCK)
          {
            break;
          }
          usleep(1000);
        }
      }
      if (sent_total != 33)
      {
        fabric_condition_destroy(&conn->conn_condition);
        fabric_mutex_destroy(&conn->conn_mutex);
        fabric_rwlock_unlock(&peer->connections_rwlock);
        close(client_sock);
        goto continue_loop;
      }
    }

    // Perform handshake as responder (accepted socket already non-blocking)
    memcpy(conn->remote_pubkey, remote_pubkey + (33 - 32), 32);
    if (noise_perform_xx_handshake(client_sock, 0, peer->app_protocol, peer->private_key, conn->remote_pubkey, &conn->send_cipher, &conn->recv_cipher) != 0)
    {
      fabric_condition_destroy(&conn->conn_condition);
      fabric_mutex_destroy(&conn->conn_mutex);
      fabric_rwlock_unlock(&peer->connections_rwlock);
      close(client_sock);
      goto continue_loop;
    }

    // Reset socket to previous flags (likely non-blocking minus O_NONBLOCK)
    fcntl(client_sock, F_SETFL, flags);

    // Increment connection count atomically
    int32_t new_count;
    if (fabric_atomic_int32_add(&peer->connection_count, 1, &new_count) != THREAD_SUCCESS)
    {
      fabric_condition_destroy(&conn->conn_condition);
      fabric_mutex_destroy(&conn->conn_mutex);
      fabric_rwlock_unlock(&peer->connections_rwlock);
      close(client_sock);
      goto continue_loop;
    }

    // Generate peer ID for scoring
    snprintf(conn->peer_id, sizeof(conn->peer_id),
             "peer_%02x%02x%02x%02x",
             remote_pubkey[1], remote_pubkey[2],
             remote_pubkey[3], remote_pubkey[4]);

    // Copy event data before releasing lock to avoid races with disconnect/compaction
    char peer_id_copy[sizeof(conn->peer_id)];
    strncpy(peer_id_copy, conn->peer_id, sizeof(peer_id_copy) - 1);
    peer_id_copy[sizeof(peer_id_copy) - 1] = '\0';
    char ipbuf[INET_ADDRSTRLEN];
    inet_ntop(AF_INET, &client_addr.sin_addr, ipbuf, sizeof(ipbuf));
    int port_copy = (int)ntohs(client_addr.sin_port);

    // Release write lock
    fabric_rwlock_unlock(&peer->connections_rwlock);

    // Add connection event to the queue using copies (safe after unlock)
    peer_add_event(peer, peer_id_copy, ipbuf, port_copy, true);

    continue;

continue_loop:
    ; // label target
  }

  return NULL;
}

FabricError peer_start_listening(Peer *peer, int port)
{
  if (!peer)
  {
    return FABRIC_ERROR_PEER_INIT_FAILED;
  }

  // Check if already listening
  FABRIC_MUTEX_LOCK_OR(&peer->listener_mutex, return FABRIC_ERROR_INTERNAL_STATE_CORRUPTION);
  if (peer->is_listening)
  {
    FABRIC_MUTEX_UNLOCK_OR(&peer->listener_mutex, return FABRIC_ERROR_INTERNAL_STATE_CORRUPTION);
    return FABRIC_ERROR_PEER_ALREADY_LISTENING;
  }

  // Create listening socket
  peer->listening_socket = socket(AF_INET, SOCK_STREAM, 0);
  if (peer->listening_socket < 0)
  {
    FABRIC_MUTEX_UNLOCK_OR(&peer->listener_mutex, return FABRIC_ERROR_INTERNAL_STATE_CORRUPTION);
    return FABRIC_ERROR_SOCKET_CREATE_FAILED;
  }

  // Enable address reuse
  int opt = 1;
  if (setsockopt(peer->listening_socket, SOL_SOCKET, SO_REUSEADDR, &opt, sizeof(opt)) < 0)
  {
    close(peer->listening_socket);
    FABRIC_MUTEX_UNLOCK_OR(&peer->listener_mutex, return FABRIC_ERROR_INTERNAL_STATE_CORRUPTION);
    return FABRIC_ERROR_SOCKET_BIND_FAILED;
  }

  // Enable port reuse
  if (setsockopt(peer->listening_socket, SOL_SOCKET, SO_REUSEPORT, &opt, sizeof(opt)) < 0)
  {
    // SO_REUSEPORT might not be available on all systems, continue anyway
  }

  // Bind to port
  struct sockaddr_in addr = {
      .sin_family = AF_INET,
      .sin_addr.s_addr = htonl(INADDR_ANY),
      .sin_port = htons(port)};

  if (bind(peer->listening_socket, (struct sockaddr *)&addr, sizeof(addr)) < 0)
  {
    close(peer->listening_socket);
    FABRIC_MUTEX_UNLOCK_OR(&peer->listener_mutex, return FABRIC_ERROR_INTERNAL_STATE_CORRUPTION);
    return FABRIC_ERROR_SOCKET_BIND_FAILED;
  }

  // Listen for connections
  if (listen(peer->listening_socket, 10) < 0)
  {
    close(peer->listening_socket);
    FABRIC_MUTEX_UNLOCK_OR(&peer->listener_mutex, return FABRIC_ERROR_INTERNAL_STATE_CORRUPTION);
    return FABRIC_ERROR_SOCKET_ACCEPT_FAILED;
  }

  // Keep listening socket blocking for accept() calls
  // Non-blocking is only needed for accepted client sockets

  // Start listening thread
  peer->is_listening = true;
  if (pthread_create(&peer->listener_thread, NULL, listener_thread_function, peer) != 0)
  {
    peer->is_listening = false;
    close(peer->listening_socket);
    FABRIC_MUTEX_UNLOCK_OR(&peer->listener_mutex, return FABRIC_ERROR_INTERNAL_STATE_CORRUPTION);
    return FABRIC_ERROR_THREAD_CREATE_FAILED;
  }

  FABRIC_MUTEX_UNLOCK_OR(&peer->listener_mutex, return FABRIC_ERROR_INTERNAL_STATE_CORRUPTION);

  printf("[fabricd] listening on port %d\n", port);

  return FABRIC_SUCCESS;
}

void peer_stop_listening(Peer *peer)
{
  if (!peer)
  {
    return;
  }

  // Use direct mutex calls to avoid return value issues
  if (fabric_mutex_lock(&peer->listener_mutex) == THREAD_SUCCESS)
  {
    if (peer->is_listening)
    {
      // Signal thread to stop
      peer->is_listening = false;

      // Close listening socket
      if (peer->listening_socket >= 0)
      {
        close(peer->listening_socket);
        peer->listening_socket = -1;
      }

      // Wait for thread to finish
      pthread_join(peer->listener_thread, NULL);
    }

    fabric_mutex_unlock(&peer->listener_mutex);
  }
}

void peer_set_protocol(Peer *peer, PeerMode mode)
{
  if (!peer) return;
  if (mode == PEER_MODE_LIGHTNING)
  {
    peer->app_protocol = NOISE_PROTOCOL_LIGHTNING;
  }
  else
  {
    peer->app_protocol = NOISE_PROTOCOL_FABRIC;
  }
  noise_get_protocol_id(peer->app_protocol, &peer->protocol_id);
}
