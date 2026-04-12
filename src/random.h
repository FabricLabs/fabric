#ifndef FABRIC_RANDOM_H
#define FABRIC_RANDOM_H

#include <stdint.h>
#include <stddef.h>
#include "errors.h"

/**
 * @file random.h
 * @brief Cryptographically secure random number generation
 *
 * This module provides secure random number generation suitable for
 * cryptographic operations. It uses system-provided entropy sources
 * and falls back gracefully when preferred methods are unavailable.
 */

/**
 * Initialize the secure random number generator.
 * This function should be called once at program startup.
 *
 * @return FABRIC_SUCCESS on success, error code on failure
 */
FabricError fabric_secure_random_init(void);

/**
 * Generate cryptographically secure random bytes.
 *
 * @param buffer Buffer to fill with random bytes
 * @param length Number of bytes to generate
 * @return FABRIC_SUCCESS on success, error code on failure
 */
FabricError fabric_secure_random_bytes(uint8_t *buffer, size_t length);

/**
 * Generate a secure random 32-bit integer.
 *
 * @param result Pointer to store the random integer
 * @return FABRIC_SUCCESS on success, error code on failure
 */
FabricError fabric_secure_random_uint32(uint32_t *result);

/**
 * Generate a secure random integer within a range [0, max_value).
 * Uses rejection sampling to avoid modulo bias.
 *
 * @param max_value Maximum value (exclusive)
 * @param result Pointer to store the random integer
 * @return FABRIC_SUCCESS on success, error code on failure
 */
FabricError fabric_secure_random_range(uint32_t max_value, uint32_t *result);

/**
 * Cleanup the secure random number generator.
 * This function should be called at program shutdown.
 */
void fabric_secure_random_cleanup(void);

/**
 * Test the entropy quality of the random number generator.
 * This function is primarily for testing and validation.
 *
 * @return FABRIC_SUCCESS if entropy appears adequate, error code otherwise
 */
FabricError fabric_secure_random_test_entropy(void);

#endif // FABRIC_RANDOM_H
