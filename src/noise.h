#ifndef FABRIC_NOISE_H
#define FABRIC_NOISE_H

#include <stddef.h>
#include <stdint.h>
#include <noise/protocol.h>

typedef enum {
  NOISE_PROTOCOL_FABRIC = 0,
  NOISE_PROTOCOL_LIGHTNING = 1
} NoiseAppProtocol;

void noise_get_protocol_id(NoiseAppProtocol app, NoiseProtocolId *out);
const uint8_t *noise_get_prologue(NoiseAppProtocol app, size_t *out_len);

/**
 * One encrypted payload on the TCP connection after Noise split.
 * Uses unsigned varint length + ciphertext — same as `@fabric/core` → `noise-protocol-stream`
 * → npm `length-prefixed-stream` (NOT Lightning BOLT #8’s 2-byte big-endian length).
 */
int fabric_noise_write_frame(int fd, const uint8_t *payload, size_t len);

/** Blocking read of one varint-length frame into payload_out (capacity out_cap). */
int fabric_noise_read_frame(int fd, uint8_t *payload_out, size_t out_cap, size_t *out_len);

/**
 * Noise XX handshake matching JS defaults: ephemeral Curve25519 each session unless
 * local_curve25519_private32_or_null is set (32 bytes).
 */
int noise_perform_xx_handshake(int sock,
                               int is_initiator,
                               NoiseAppProtocol app,
                               const uint8_t *local_curve25519_private32_or_null,
                               const uint8_t *remote_curve25519_public32_or_null,
                               NoiseCipherState **out_send,
                               NoiseCipherState **out_recv);

#endif // FABRIC_NOISE_H


