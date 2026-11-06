#ifndef FABRIC_CONSTANTS_H
#define FABRIC_CONSTANTS_H

// Wire-format magic (big-endian on the wire): c0 d3 f3 3d
#define FABRIC_WIRE_MAGIC 0xC0D3F33D

// Message/version constants
#define FABRIC_MESSAGE_VERSION 1
/** Max ciphertext bytes per Noise transport frame (matches `noise-protocol-stream` MESSAGE_SIZE). */
#define FABRIC_NOISE_MAX_FRAME_BYTES 65535
/** Poly1305 tag on every Noise transport frame. */
#define FABRIC_NOISE_MAC_BYTES 16
/* Header bytes (magic, version, parent, author, type, size, hash, preimage, signature) */
#define FABRIC_MESSAGE_HEADER_BYTES 208
/* Max bytes of one AMP frame on the wire (header + body): the largest plaintext one Noise
 * transport frame carries (65519 B). Keep in sync with `MAX_FRAME_BYTES` in `constants.js`. */
#define FABRIC_MAX_FRAME_BYTES (FABRIC_NOISE_MAX_FRAME_BYTES - FABRIC_NOISE_MAC_BYTES)
/* Max payload bytes (65311 B). Keep in sync with `MAX_MESSAGE_SIZE` in `constants.js`. */
#define FABRIC_MAX_MESSAGE_BODY (FABRIC_MAX_FRAME_BYTES - FABRIC_MESSAGE_HEADER_BYTES)

// Default networking
#define FABRIC_DEFAULT_PORT 7777

// Bitcoin network magics
#define FABRIC_NETWORK_MAGIC_MAINNET 0xF9BEB4D9
#define FABRIC_NETWORK_MAGIC_REGTEST 0xFABFB5DA

#endif // FABRIC_CONSTANTS_H


