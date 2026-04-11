#ifndef VALIDATION_H
#define VALIDATION_H

#include <stdint.h>
#include <stdbool.h>
#include <stddef.h>
#include "errors.h"

/**
 * @file validation.h
 * @brief Comprehensive input validation framework
 *
 * This module provides secure input validation functions to prevent
 * injection attacks, buffer overflows, and malformed data processing.
 * All validation functions are designed to fail safely and provide
 * clear error reporting.
 */

// Maximum safe sizes for various input types
#define FABRIC_MAX_PEER_ID_LENGTH 64
#define FABRIC_MAX_IP_ADDRESS_LENGTH 45  // IPv6 max length
#define FABRIC_MAX_HOSTNAME_LENGTH 253   // DNS hostname max
#define FABRIC_MAX_MESSAGE_SIZE 65536    // 64KB max message
#define FABRIC_MAX_PATH_LENGTH 4096      // Maximum file path length

// Port number ranges
#define FABRIC_MIN_PORT 1
#define FABRIC_MAX_PORT 65535
#define FABRIC_MIN_UNPRIVILEGED_PORT 1024

// Cryptographic key sizes (in bytes)
#define FABRIC_PRIVATE_KEY_SIZE 32
#define FABRIC_PUBLIC_KEY_SIZE 33        // Compressed secp256k1
#define FABRIC_SIGNATURE_SIZE 64         // Schnorr signature
#define FABRIC_HASH_SIZE 32              // SHA256

/**
 * Initialize the validation subsystem.
 * This should be called once at program startup.
 *
 * @return FABRIC_SUCCESS on success, error code on failure
 */
FabricError fabric_validation_init(void);

/**
 * Cleanup the validation subsystem.
 * This should be called at program shutdown.
 */
void fabric_validation_cleanup(void);

/* ========================================================================
 * CRYPTOGRAPHIC INPUT VALIDATION
 * ======================================================================== */

/**
 * Validate a private key.
 * Ensures the key is the correct size and within valid secp256k1 range.
 *
 * @param privkey Private key bytes
 * @param len Length of private key
 * @return FABRIC_SUCCESS if valid, error code otherwise
 */
FabricError fabric_validate_private_key(const uint8_t *privkey, size_t len);

/**
 * Validate a public key.
 * Ensures the key is properly formatted compressed secp256k1 public key.
 *
 * @param pubkey Public key bytes
 * @param len Length of public key
 * @return FABRIC_SUCCESS if valid, error code otherwise
 */
FabricError fabric_validate_public_key(const uint8_t *pubkey, size_t len);

/**
 * Validate a cryptographic signature.
 * Ensures the signature is the correct size and format.
 *
 * @param sig Signature bytes
 * @param len Length of signature
 * @return FABRIC_SUCCESS if valid, error code otherwise
 */
FabricError fabric_validate_signature(const uint8_t *sig, size_t len);

/**
 * Validate a cryptographic hash.
 * Ensures the hash is the correct size.
 *
 * @param hash Hash bytes
 * @param len Length of hash
 * @return FABRIC_SUCCESS if valid, error code otherwise
 */
FabricError fabric_validate_hash(const uint8_t *hash, size_t len);

/* ========================================================================
 * NETWORK INPUT VALIDATION
 * ======================================================================== */

/**
 * Validate an IPv4 address string.
 *
 * @param ip_str IP address string
 * @return FABRIC_SUCCESS if valid IPv4, error code otherwise
 */
FabricError fabric_validate_ipv4_address(const char *ip_str);

/**
 * Validate an IPv6 address string.
 *
 * @param ip_str IP address string
 * @return FABRIC_SUCCESS if valid IPv6, error code otherwise
 */
FabricError fabric_validate_ipv6_address(const char *ip_str);

/**
 * Validate an IP address (IPv4 or IPv6).
 *
 * @param ip_str IP address string
 * @return FABRIC_SUCCESS if valid IP address, error code otherwise
 */
FabricError fabric_validate_ip_address(const char *ip_str);

/**
 * Validate a network port number.
 *
 * @param port Port number to validate
 * @param allow_privileged Whether to allow privileged ports (< 1024)
 * @return FABRIC_SUCCESS if valid, error code otherwise
 */
FabricError fabric_validate_port(int port, bool allow_privileged);

/**
 * Validate a peer ID string.
 * Ensures peer ID contains only safe characters and is reasonable length.
 *
 * @param peer_id Peer ID string
 * @return FABRIC_SUCCESS if valid, error code otherwise
 */
FabricError fabric_validate_peer_id(const char *peer_id);

/**
 * Validate a hostname.
 * Ensures hostname follows DNS naming conventions.
 *
 * @param hostname Hostname string
 * @return FABRIC_SUCCESS if valid, error code otherwise
 */
FabricError fabric_validate_hostname(const char *hostname);

/* ========================================================================
 * MESSAGE AND DATA VALIDATION
 * ======================================================================== */

/**
 * Validate message size.
 * Ensures message size is within acceptable limits.
 *
 * @param size Message size in bytes
 * @return FABRIC_SUCCESS if valid, error code otherwise
 */
FabricError fabric_validate_message_size(uint32_t size);

/**
 * Validate message type.
 * Ensures message type is within known ranges.
 *
 * @param type Message type identifier
 * @return FABRIC_SUCCESS if valid, error code otherwise
 */
FabricError fabric_validate_message_type(uint32_t type);

/**
 * Validate a file path.
 * Ensures path doesn't contain dangerous sequences and is reasonable length.
 *
 * @param path File path string
 * @return FABRIC_SUCCESS if valid, error code otherwise
 */
FabricError fabric_validate_file_path(const char *path);

/* ========================================================================
 * SAFE BUFFER OPERATIONS
 * ======================================================================== */

/**
 * Safe buffer copy with validation.
 * Performs bounds checking and validation before copying.
 *
 * @param dest Destination buffer
 * @param dest_size Size of destination buffer
 * @param src Source buffer
 * @param src_size Number of bytes to copy
 * @return FABRIC_SUCCESS on success, error code on failure
 */
FabricError fabric_safe_buffer_copy(void *dest, size_t dest_size,
                                   const void *src, size_t src_size);

/**
 * Safe string concatenation.
 * Ensures the result fits in the destination buffer.
 *
 * @param dest Destination string buffer
 * @param dest_size Size of destination buffer
 * @param src Source string to append
 * @return FABRIC_SUCCESS on success, error code on failure
 */
FabricError fabric_safe_string_concat(char *dest, size_t dest_size, const char *src);

/**
 * Safe string copy.
 * Ensures null termination and bounds checking.
 *
 * @param dest Destination buffer
 * @param dest_size Size of destination buffer
 * @param src Source string
 * @return FABRIC_SUCCESS on success, error code on failure
 */
FabricError fabric_safe_string_copy(char *dest, size_t dest_size, const char *src);

/**
 * Safe integer parsing.
 * Parses integer with bounds checking and overflow protection.
 *
 * @param str String to parse
 * @param result Pointer to store parsed integer
 * @param min_value Minimum allowed value
 * @param max_value Maximum allowed value
 * @return FABRIC_SUCCESS on success, error code on failure
 */
FabricError fabric_safe_parse_int(const char *str, int *result, int min_value, int max_value);

/**
 * Safe unsigned integer parsing.
 * Parses unsigned integer with bounds checking and overflow protection.
 *
 * @param str String to parse
 * @param result Pointer to store parsed integer
 * @param max_value Maximum allowed value
 * @return FABRIC_SUCCESS on success, error code on failure
 */
FabricError fabric_safe_parse_uint(const char *str, unsigned int *result, unsigned int max_value);

/* ========================================================================
 * STRING VALIDATION AND SANITIZATION
 * ======================================================================== */

/**
 * Validate string contains only safe characters.
 * Checks for control characters, null bytes, and other dangerous content.
 *
 * @param str String to validate
 * @param max_length Maximum allowed length
 * @return FABRIC_SUCCESS if safe, error code otherwise
 */
FabricError fabric_validate_safe_string(const char *str, size_t max_length);

/**
 * Validate string contains only printable ASCII characters.
 *
 * @param str String to validate
 * @param max_length Maximum allowed length
 * @return FABRIC_SUCCESS if valid, error code otherwise
 */
FabricError fabric_validate_printable_string(const char *str, size_t max_length);

/**
 * Validate string contains only alphanumeric characters and safe punctuation.
 *
 * @param str String to validate
 * @param max_length Maximum allowed length
 * @return FABRIC_SUCCESS if valid, error code otherwise
 */
FabricError fabric_validate_alphanumeric_string(const char *str, size_t max_length);

/**
 * Sanitize string by replacing dangerous characters.
 *
 * @param dest Destination buffer
 * @param dest_size Size of destination buffer
 * @param src Source string to sanitize
 * @param replacement Character to use for dangerous characters
 * @return FABRIC_SUCCESS on success, error code on failure
 */
FabricError fabric_sanitize_string(char *dest, size_t dest_size,
                                  const char *src, char replacement);

#endif // VALIDATION_H
