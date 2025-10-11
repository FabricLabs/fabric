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

#include "peer.h"
#include "message.h"

static NoiseProtocolId protocol_id = {
    .prefix_id = NOISE_PREFIX_STANDARD,
    .pattern_id = NOISE_PATTERN_XX,
    .cipher_id = NOISE_CIPHER_CHACHAPOLY,
    .hash_id = NOISE_HASH_SHA256,
    .dh_id = NOISE_DH_CURVE25519};

FabricError perform_handshake(Connection *conn, const uint8_t *private_key, const uint8_t *public_key, int is_initiator)
{
  NoiseHandshakeState *handshake = NULL;
  uint8_t buffer[PEER_BUFFER_SIZE];
  int handshake_complete = 0;
  int timeout_count = 0;
  const int max_timeout = 100; // 100 attempts before timeout

  // Initialize handshake state
  if (noise_handshakestate_new_by_id(&handshake, &protocol_id,
                                     is_initiator ? NOISE_ROLE_INITIATOR : NOISE_ROLE_RESPONDER) != NOISE_ERROR_NONE)
  {
    return FABRIC_ERROR_NOISE_INIT_FAILED;
  }

  // Set prologue
  const uint8_t prologue[] = "FABRIC";
  if (noise_handshakestate_set_prologue(handshake, prologue, sizeof(prologue) - 1) != NOISE_ERROR_NONE)
  {
    goto cleanup;
  }

  // Set keypairs
  NoiseDHState *dh = noise_handshakestate_get_local_keypair_dh(handshake);
  if (!dh)
    goto cleanup;

  if (noise_dhstate_set_keypair_private(dh, private_key, 32) != NOISE_ERROR_NONE)
  {
    goto cleanup;
  }

  if (public_key)
  {
    dh = noise_handshakestate_get_remote_public_key_dh(handshake);
    if (!dh)
      goto cleanup;
    if (noise_dhstate_set_public_key(dh, public_key, 32) != NOISE_ERROR_NONE)
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

      ssize_t sent = send(conn->sock, mbuf.data, mbuf.size, 0);
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
    peer->protocol_id = protocol_id;

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
  }
  return peer;
}

void peer_destroy(Peer *peer)
{
  if (!peer)
    return;

  // Clean up secp256k1 context
  if (peer->secp256k1_ctx)
  {
    secp256k1_context_destroy(peer->secp256k1_ctx);
  }

  // Clean up all connections
  int32_t conn_count;
  if (fabric_atomic_int32_get(&peer->connection_count, &conn_count) == THREAD_SUCCESS)
  {
    for (int i = 0; i < conn_count; i++)
    {
      peer_disconnect(peer, i);
    }
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

  // Close socket
  if (conn->sock >= 0)
  {
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

  // Remove connection from array by shifting remaining connections
  if (connection_id < current_count - 1)
  {
    memmove(&peer->connections[connection_id], &peer->connections[connection_id + 1], (current_count - connection_id - 1) * sizeof(Connection));
  }

  // Decrement connection count atomically
  int32_t new_count;
  fabric_atomic_int32_sub(&peer->connection_count, 1, &new_count);

  // Clean up connection thread safety primitives
  fabric_condition_destroy(&conn->conn_condition);
  fabric_mutex_destroy(&conn->conn_mutex);

  // Release write lock
  fabric_rwlock_unlock(&peer->connections_rwlock);
}

FabricError peer_connect(Peer *peer, const char *host, int port)
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

  // Get write lock for connections array
  FABRIC_RWLOCK_WRLOCK(&peer->connections_rwlock);

  int32_t conn_index;
  if (fabric_atomic_int32_get(&peer->connection_count, &conn_index) != THREAD_SUCCESS)
  {
    FABRIC_RWLOCK_UNLOCK(&peer->connections_rwlock);
    return FABRIC_ERROR_INTERNAL_STATE_CORRUPTION;
  }

  Connection *conn = &peer->connections[conn_index];

  // Initialize connection thread safety primitives
  if (fabric_mutex_init(&conn->conn_mutex, "connection_mutex") != THREAD_SUCCESS)
  {
    FABRIC_RWLOCK_UNLOCK(&peer->connections_rwlock);
    return FABRIC_ERROR_INTERNAL_STATE_CORRUPTION;
  }

  if (fabric_condition_init(&conn->conn_condition, "connection_condition") != THREAD_SUCCESS)
  {
    fabric_mutex_destroy(&conn->conn_mutex);
    FABRIC_RWLOCK_UNLOCK(&peer->connections_rwlock);
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

  // Set socket to non-blocking for connect
  int flags = fcntl(conn->sock, F_GETFL, 0);
  fcntl(conn->sock, F_SETFL, flags | O_NONBLOCK);

  // Connect
  if (connect(conn->sock, (struct sockaddr *)&addr, sizeof(addr)) < 0)
  {
    if (errno != EINPROGRESS)
    {
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
      close(conn->sock);
      return FABRIC_ERROR_CONNECTION_TIMEOUT;
    }

    // Check if connection was successful
    int error = 0;
    socklen_t len = sizeof(error);
    if (getsockopt(conn->sock, SOL_SOCKET, SO_ERROR, &error, &len) < 0 || error != 0)
    {
      close(conn->sock);
      return FABRIC_ERROR_SOCKET_CONNECT_FAILED;
    }
  }

  // Exchange public keys first
  // Send our public key
  if (send(conn->sock, peer->public_key, 33, 0) != 33)
  {
    close(conn->sock);
    return FABRIC_ERROR_SOCKET_SEND_FAILED;
  }

  // Receive remote public key
  uint8_t remote_pubkey[33];
  if (recv(conn->sock, remote_pubkey, 33, 0) != 33)
  {
    close(conn->sock);
    return FABRIC_ERROR_SOCKET_RECV_FAILED;
  }

  // Set socket to non-blocking for handshake
  fcntl(conn->sock, F_SETFL, flags | O_NONBLOCK);

  // Perform handshake as initiator with remote public key
  conn->is_initiator = 1;
  if (perform_handshake(conn, peer->private_key, remote_pubkey, 1) != FABRIC_SUCCESS)
  {
    close(conn->sock);
    return FABRIC_ERROR_NOISE_HANDSHAKE_FAILED;
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
    FABRIC_RWLOCK_UNLOCK(&peer->connections_rwlock);
    return FABRIC_ERROR_INTERNAL_STATE_CORRUPTION;
  }

  // Release write lock
  FABRIC_RWLOCK_UNLOCK(&peer->connections_rwlock);

  return FABRIC_SUCCESS;
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
  FABRIC_RWLOCK_WRLOCK(&peer->connections_rwlock);

  int32_t conn_index;
  if (fabric_atomic_int32_get(&peer->connection_count, &conn_index) != THREAD_SUCCESS)
  {
    FABRIC_RWLOCK_UNLOCK(&peer->connections_rwlock);
    return FABRIC_ERROR_INTERNAL_STATE_CORRUPTION;
  }

  Connection *conn = &peer->connections[conn_index];

  // Initialize connection thread safety primitives
  if (fabric_mutex_init(&conn->conn_mutex, "connection_mutex") != THREAD_SUCCESS)
  {
    FABRIC_RWLOCK_UNLOCK(&peer->connections_rwlock);
    return FABRIC_ERROR_INTERNAL_STATE_CORRUPTION;
  }

  if (fabric_condition_init(&conn->conn_condition, "connection_condition") != THREAD_SUCCESS)
  {
    fabric_mutex_destroy(&conn->conn_mutex);
    FABRIC_RWLOCK_UNLOCK(&peer->connections_rwlock);
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

  // Exchange public keys first
  // Receive remote public key
  uint8_t remote_pubkey[33];
  if (recv(conn->sock, remote_pubkey, 33, 0) != 33)
  {
    close(conn->sock);
    return FABRIC_ERROR_SOCKET_RECV_FAILED;
  }

  // Send our public key
  if (send(conn->sock, peer->public_key, 33, 0) != 33)
  {
    close(conn->sock);
    return FABRIC_ERROR_SOCKET_SEND_FAILED;
  }

  if (perform_handshake(conn, peer->private_key, remote_pubkey, 0) != FABRIC_SUCCESS)
  {
    close(conn->sock);
    return FABRIC_ERROR_NOISE_HANDSHAKE_FAILED;
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
    FABRIC_RWLOCK_UNLOCK(&peer->connections_rwlock);
    return FABRIC_ERROR_INTERNAL_STATE_CORRUPTION;
  }

  // Release write lock
  FABRIC_RWLOCK_UNLOCK(&peer->connections_rwlock);

  return FABRIC_SUCCESS;
}

FabricError peer_generate_keypair(Peer *peer)
{
  if (!peer || !peer->secp256k1_ctx)
    return FABRIC_ERROR_PEER_INIT_FAILED;

  // Create new keypair using secp256k1
  secp256k1_keypair keypair;
  uint8_t seckey[32];

  // Generate random private key
  for (int i = 0; i < 32; i++)
  {
    seckey[i] = rand() % 256;
  }

  // Ensure it's a valid secp256k1 private key
  if (secp256k1_ec_seckey_verify(peer->secp256k1_ctx, seckey) != 1)
  {
    return FABRIC_ERROR_INVALID_KEY;
  }

  // Create keypair
  if (secp256k1_keypair_create(peer->secp256k1_ctx, &keypair, seckey) != 1)
  {
    return FABRIC_ERROR_KEY_GENERATION_FAILED;
  }

  // Get public key
  secp256k1_pubkey pubkey;
  if (secp256k1_keypair_pub(peer->secp256k1_ctx, &pubkey, &keypair) != 1)
  {
    return FABRIC_ERROR_KEY_GENERATION_FAILED;
  }

  // Serialize public key to compressed format (33 bytes)
  size_t pubkey_len = 33;
  if (secp256k1_ec_pubkey_serialize(peer->secp256k1_ctx, peer->public_key, &pubkey_len, &pubkey, SECP256K1_EC_COMPRESSED) != 1)
  {
    return FABRIC_ERROR_KEY_GENERATION_FAILED;
  }

  // Copy private key
  memcpy(peer->private_key, seckey, 32);

  return FABRIC_SUCCESS;
}

FabricError peer_send_message(Peer *peer, int connection_id, const Message *message)
{
  if (!peer || !message)
    return FABRIC_ERROR_PEER_INIT_FAILED;

  // Check connection ID bounds atomically
  int32_t current_count;
  if (fabric_atomic_int32_get(&peer->connection_count, &current_count) != THREAD_SUCCESS)
  {
    return FABRIC_ERROR_INTERNAL_STATE_CORRUPTION;
  }

  if (connection_id >= current_count)
    return FABRIC_ERROR_PEER_INVALID_CONNECTION;

  // Get read lock for connections array
  FABRIC_RWLOCK_RDLOCK(&peer->connections_rwlock);

  Connection *conn = &peer->connections[connection_id];

  // Lock connection for send operation
  FABRIC_MUTEX_LOCK(&conn->conn_mutex);

  uint8_t buffer[PEER_BUFFER_SIZE];
  size_t message_size = sizeof(Message) - sizeof(uint8_t *) + message->size;

  // Serialize message
  memcpy(buffer, message, sizeof(Message) - sizeof(uint8_t *));
  if (message->body && message->size > 0)
  {
    memcpy(buffer + sizeof(Message) - sizeof(uint8_t *), message->body, message->size);
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
    ssize_t sent = send(conn->sock, noise_buffer.data, noise_buffer.size, 0);
    if (sent > 0 && (size_t)sent == noise_buffer.size)
    {
      // Unlock connection and release read lock
      FABRIC_MUTEX_UNLOCK(&conn->conn_mutex);
      FABRIC_RWLOCK_UNLOCK(&peer->connections_rwlock);
      return FABRIC_SUCCESS;
    }

    if (errno != EAGAIN && errno != EWOULDBLOCK)
    {
      break;
    }
    retries--;
    usleep(1000); // 1ms backoff
  }
  // Unlock connection and release read lock on error
  FABRIC_MUTEX_UNLOCK(&conn->conn_mutex);
  FABRIC_RWLOCK_UNLOCK(&peer->connections_rwlock);

  return FABRIC_ERROR_SOCKET_SEND_FAILED;
}

FabricError peer_receive_message(Peer *peer, int connection_id, Message *message)
{
  if (!peer || !message)
    return FABRIC_ERROR_PEER_INIT_FAILED;

  // Check connection ID bounds atomically
  int32_t current_count;
  if (fabric_atomic_int32_get(&peer->connection_count, &current_count) != THREAD_SUCCESS)
  {
    return FABRIC_ERROR_INTERNAL_STATE_CORRUPTION;
  }

  if (connection_id >= current_count)
    return FABRIC_ERROR_PEER_INVALID_CONNECTION;

  // Get read lock for connections array
  FABRIC_RWLOCK_RDLOCK(&peer->connections_rwlock);

  Connection *conn = &peer->connections[connection_id];

  // Lock connection for receive operation
  FABRIC_MUTEX_LOCK(&conn->conn_mutex);

  uint8_t buffer[PEER_BUFFER_SIZE];

  // Add retry logic to receive function
  int retries = 3;
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
      if (noise_cipherstate_decrypt(conn->recv_cipher, &noise_buffer) != NOISE_ERROR_NONE)
      {
        return FABRIC_ERROR_NOISE_READ_FAILED;
      }

      // Deserialize the message header
      if (noise_buffer.size < sizeof(Message) - sizeof(uint8_t *))
      {
        return FABRIC_ERROR_MESSAGE_INVALID_FORMAT;
      }
      memcpy(message, buffer, sizeof(Message) - sizeof(uint8_t *));

      // Verify message size
      size_t body_offset = sizeof(Message) - sizeof(uint8_t *);
      if (message->size > 0)
      {
        if (noise_buffer.size < body_offset + message->size)
        {
          return FABRIC_ERROR_MESSAGE_INVALID_FORMAT;
        }
        // Allocate and copy body
        message->body = malloc(message->size);
        if (!message->body)
        {
          return FABRIC_ERROR_OUT_OF_MEMORY;
        }
        memcpy(message->body, buffer + body_offset, message->size);
      }
      else
      {
        message->body = NULL;
      }

      // Unlock connection and release read lock on success
      FABRIC_MUTEX_UNLOCK(&conn->conn_mutex);
      FABRIC_RWLOCK_UNLOCK(&peer->connections_rwlock);

      return FABRIC_SUCCESS;
    }
    if (errno != EAGAIN && errno != EWOULDBLOCK)
    {
      break;
    }
    retries--;
    usleep(1000); // 1ms backoff
  }

  // Unlock connection and release read lock on error
  FABRIC_MUTEX_UNLOCK(&conn->conn_mutex);
  FABRIC_RWLOCK_UNLOCK(&peer->connections_rwlock);

  return FABRIC_ERROR_SOCKET_RECV_FAILED;
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
  FABRIC_RWLOCK_RDLOCK(&peer->connections_rwlock);

  Connection *conn = &peer->connections[current_count - 1];

  // Lock connection for timeout operation
  FABRIC_MUTEX_LOCK(&conn->conn_mutex);

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
  FABRIC_MUTEX_UNLOCK(&conn->conn_mutex);
  FABRIC_RWLOCK_UNLOCK(&peer->connections_rwlock);

  return FABRIC_SUCCESS;
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
      if (errno == EAGAIN || errno == EWOULDBLOCK)
      {
        // No pending connections, sleep briefly
        usleep(100000); // 100ms
        continue;
      }
      // Real error, log it but continue listening
      perror("Accept error");
      continue;
    }

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
    FABRIC_RWLOCK_WRLOCK(&peer->connections_rwlock);

    int32_t conn_index;
    if (fabric_atomic_int32_get(&peer->connection_count, &conn_index) != THREAD_SUCCESS)
    {
      FABRIC_RWLOCK_UNLOCK(&peer->connections_rwlock);
      close(client_sock);
      continue;
    }

    Connection *conn = &peer->connections[conn_index];

    // Initialize connection thread safety primitives
    if (fabric_mutex_init(&conn->conn_mutex, "connection_mutex") != THREAD_SUCCESS)
    {
      FABRIC_RWLOCK_UNLOCK(&peer->connections_rwlock);
      close(client_sock);
      continue;
    }

    if (fabric_condition_init(&conn->conn_condition, "connection_condition") != THREAD_SUCCESS)
    {
      fabric_mutex_destroy(&conn->conn_mutex);
      FABRIC_RWLOCK_UNLOCK(&peer->connections_rwlock);
      close(client_sock);
      continue;
    }

    // Set up the connection
    conn->sock = client_sock;
    conn->is_initiator = 0;
    conn->connection_time = time(NULL);

    // Set socket to non-blocking for handshake
    int flags = fcntl(client_sock, F_GETFL, 0);
    fcntl(client_sock, F_SETFL, flags | O_NONBLOCK);

    // Exchange public keys first
    uint8_t remote_pubkey[33];
    if (recv(client_sock, remote_pubkey, 33, 0) != 33)
    {
      fabric_condition_destroy(&conn->conn_condition);
      fabric_mutex_destroy(&conn->conn_mutex);
      FABRIC_RWLOCK_UNLOCK(&peer->connections_rwlock);
      close(client_sock);
      continue;
    }

    // Send our public key
    if (send(client_sock, peer->public_key, 33, 0) != 33)
    {
      fabric_condition_destroy(&conn->conn_condition);
      fabric_mutex_destroy(&conn->conn_mutex);
      FABRIC_RWLOCK_UNLOCK(&peer->connections_rwlock);
      close(client_sock);
      continue;
    }

    // Perform handshake as responder
    if (perform_handshake(conn, peer->private_key, remote_pubkey, 0) != FABRIC_SUCCESS)
    {
      fabric_condition_destroy(&conn->conn_condition);
      fabric_mutex_destroy(&conn->conn_mutex);
      FABRIC_RWLOCK_UNLOCK(&peer->connections_rwlock);
      close(client_sock);
      continue;
    }

    // Reset socket to blocking
    fcntl(client_sock, F_SETFL, flags);

    // Increment connection count atomically
    int32_t new_count;
    if (fabric_atomic_int32_add(&peer->connection_count, 1, &new_count) != THREAD_SUCCESS)
    {
      fabric_condition_destroy(&conn->conn_condition);
      fabric_mutex_destroy(&conn->conn_mutex);
      FABRIC_RWLOCK_UNLOCK(&peer->connections_rwlock);
      close(client_sock);
      continue;
    }

    // Generate peer ID for scoring
    snprintf(conn->peer_id, sizeof(conn->peer_id),
             "peer_%02x%02x%02x%02x",
             remote_pubkey[1], remote_pubkey[2],
             remote_pubkey[3], remote_pubkey[4]);

    // Release write lock
    FABRIC_RWLOCK_UNLOCK(&peer->connections_rwlock);

    printf("[PEER] Accepted connection from %s:%d (peer: %s)\n",
           inet_ntoa(client_addr.sin_addr), ntohs(client_addr.sin_port), conn->peer_id);
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
  FABRIC_MUTEX_LOCK(&peer->listener_mutex);
  if (peer->is_listening)
  {
    FABRIC_MUTEX_UNLOCK(&peer->listener_mutex);
    return FABRIC_ERROR_PEER_ALREADY_LISTENING;
  }

  // Create listening socket
  peer->listening_socket = socket(AF_INET, SOCK_STREAM, 0);
  if (peer->listening_socket < 0)
  {
    FABRIC_MUTEX_UNLOCK(&peer->listener_mutex);
    return FABRIC_ERROR_SOCKET_CREATE_FAILED;
  }

  // Enable address reuse
  int opt = 1;
  if (setsockopt(peer->listening_socket, SOL_SOCKET, SO_REUSEADDR, &opt, sizeof(opt)) < 0)
  {
    close(peer->listening_socket);
    FABRIC_MUTEX_UNLOCK(&peer->listener_mutex);
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
    FABRIC_MUTEX_UNLOCK(&peer->listener_mutex);
    return FABRIC_ERROR_SOCKET_BIND_FAILED;
  }

  // Listen for connections
  if (listen(peer->listening_socket, 10) < 0)
  {
    close(peer->listening_socket);
    FABRIC_MUTEX_UNLOCK(&peer->listener_mutex);
    return FABRIC_ERROR_SOCKET_ACCEPT_FAILED;
  }

  // Set socket to non-blocking for accept
  int flags = fcntl(peer->listening_socket, F_GETFL, 0);
  fcntl(peer->listening_socket, F_SETFL, flags | O_NONBLOCK);

  // Start listening thread
  peer->is_listening = true;
  if (pthread_create(&peer->listener_thread, NULL, listener_thread_function, peer) != 0)
  {
    peer->is_listening = false;
    close(peer->listening_socket);
    FABRIC_MUTEX_UNLOCK(&peer->listener_mutex);
    return FABRIC_ERROR_THREAD_CREATE_FAILED;
  }

  FABRIC_MUTEX_UNLOCK(&peer->listener_mutex);

  printf("[PEER] Started listening on port %d\n", port);
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

      printf("[PEER] Stopped listening\n");
    }

    fabric_mutex_unlock(&peer->listener_mutex);
  }
}
