#ifndef FABRIC_CONSTANTS_H
#define FABRIC_CONSTANTS_H

// Wire-format magic (big-endian on the wire): c0 d3 f3 3d
#define FABRIC_WIRE_MAGIC 0xC0D3F33D

// Message/version constants
#define FABRIC_MESSAGE_VERSION 1
/* Max payload bytes (4096 byte frame − 208-byte on-wire header: magic…signature) */
#define FABRIC_MAX_MESSAGE_BODY 3888

// Default networking
#define FABRIC_DEFAULT_PORT 7777

// Bitcoin network magics
#define FABRIC_NETWORK_MAGIC_MAINNET 0xF9BEB4D9
#define FABRIC_NETWORK_MAGIC_REGTEST 0xFABFB5DA

#endif // FABRIC_CONSTANTS_H


