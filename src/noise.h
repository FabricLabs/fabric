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

int noise_perform_xx_handshake(int sock,
                               int is_initiator,
                               NoiseAppProtocol app,
                               const uint8_t *local_private32,
                               const uint8_t *remote_public32_or_null,
                               NoiseCipherState **out_send,
                               NoiseCipherState **out_recv);

#endif // FABRIC_NOISE_H


