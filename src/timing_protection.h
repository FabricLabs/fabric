#ifndef TIMING_PROTECTION_H
#define TIMING_PROTECTION_H

#include <stddef.h>
#include <stdint.h>
#include <stdbool.h>

// Timing attack protection constants
#define TIMING_PROTECTION_MAX_SIZE 1024

// Constant-time memory comparison - immune to timing attacks
// Returns true if buffers are equal, false otherwise
bool fabric_constant_time_memcmp(const void *a, const void *b, size_t size);

// Constant-time string comparison - immune to timing attacks
// Returns true if strings are equal, false otherwise
bool fabric_constant_time_strcmp(const char *a, const char *b);

// Constant-time buffer comparison with size validation
// Returns true if buffers are equal, false otherwise
bool fabric_constant_time_buffer_cmp(const uint8_t *a, uint8_t a_size,
                                   const uint8_t *b, uint8_t b_size);

// Secure random number generation for cryptographic operations
// Fills buffer with cryptographically secure random bytes
int fabric_secure_random(uint8_t *buffer, size_t size);

// Constant-time array copy - prevents timing-based memory access patterns
void fabric_constant_time_copy(void *dest, const void *src, size_t size);

// Constant-time array zeroing - prevents timing-based memory access patterns
void fabric_constant_time_zero(void *ptr, size_t size);

// Secure hash comparison - constant-time comparison of hash values
bool fabric_constant_time_hash_cmp(const uint8_t *hash1, const uint8_t *hash2, size_t hash_size);

// Secure signature verification wrapper with timing protection
// This should be used instead of direct secp256k1 calls
int fabric_secure_signature_verify(const uint8_t *signature, const uint8_t *hash,
                                 const uint8_t *public_key, size_t key_size);

// Timing attack detection and logging
typedef struct {
    size_t comparison_count;
    size_t suspicious_timing_count;
    double average_comparison_time;
    double max_comparison_time;
    double min_comparison_time;
} TimingProtectionStats;

// Get timing protection statistics
void fabric_get_timing_stats(TimingProtectionStats *stats);

// Reset timing protection statistics
void fabric_reset_timing_stats(void);

// Enable/disable timing attack detection
void fabric_set_timing_detection(bool enabled);

// Check if timing attack detection is enabled
bool fabric_is_timing_detection_enabled(void);

#endif // TIMING_PROTECTION_H
