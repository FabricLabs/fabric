#ifndef FABRIC_CONSTANTS_H
#define FABRIC_CONSTANTS_H

// Wire-format magic (big-endian on the wire): c0 d3 f3 3d
#define FABRIC_WIRE_MAGIC 0xC0D3F33D

// Message/version constants
#define FABRIC_MESSAGE_VERSION 1
/* Max payload bytes (32 KiB body; 208-byte on-wire header: magic…signature → 32976-byte frame).
 * Keep in sync with `MAX_MESSAGE_SIZE` in `constants.js`. */
#define FABRIC_MAX_MESSAGE_BODY 32768
/* Header bytes (magic, version, parent, author, type, size, hash, preimage, signature) */
#define FABRIC_MESSAGE_HEADER_BYTES 208
/* Max bytes of one AMP frame on the wire (header + body) */
#define FABRIC_MAX_FRAME_BYTES (FABRIC_MESSAGE_HEADER_BYTES + FABRIC_MAX_MESSAGE_BODY)

/** Max ciphertext bytes per Noise transport frame (matches `noise-protocol-stream` MESSAGE_SIZE). */
#define FABRIC_NOISE_MAX_FRAME_BYTES 65535

// Default networking
#define FABRIC_DEFAULT_PORT 7777

// Bitcoin network magics
#define FABRIC_NETWORK_MAGIC_MAINNET 0xF9BEB4D9
#define FABRIC_NETWORK_MAGIC_REGTEST 0xFABFB5DA

#endif // FABRIC_CONSTANTS_H


