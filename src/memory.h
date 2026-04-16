#ifndef FABRIC_MEMORY_H
#define FABRIC_MEMORY_H

#include <stddef.h>
#include <stdint.h>
#include "errors.h"

/**
 * @file memory.h
 * @brief Secure memory management utilities
 *
 * This module provides secure memory operations that prevent
 * sensitive data from being leaked through memory dumps, swap files,
 * or compiler optimizations.
 */

/**
 * Securely zero memory contents.
 * This function prevents compiler optimizations from removing
 * the zeroing operation, ensuring sensitive data is actually cleared.
 *
 * @param ptr Pointer to memory to zero
 * @param len Number of bytes to zero
 */
void fabric_secure_zero(volatile void *ptr, size_t len);

/**
 * Allocate memory and initialize to zero.
 * The allocated memory should be freed with fabric_secure_free().
 *
 * @param size Number of bytes to allocate
 * @return Pointer to allocated memory, or NULL on failure
 */
void *fabric_secure_malloc(size_t size);

/**
 * Securely free allocated memory.
 * This function zeros the memory before freeing it.
 *
 * @param ptr Pointer to memory to free
 * @param size Size of the memory block (for zeroing)
 */
void fabric_secure_free(void *ptr, size_t size);

/**
 * Reallocate memory securely.
 * If the new size is smaller, the excess memory is securely zeroed.
 * If reallocation fails, the original memory is not freed or modified.
 *
 * @param ptr Pointer to existing memory block
 * @param old_size Size of the existing memory block
 * @param new_size New size requested
 * @return Pointer to reallocated memory, or NULL on failure
 */
void *fabric_secure_realloc(void *ptr, size_t old_size, size_t new_size);

/**
 * Constant-time memory comparison.
 * This function compares two memory regions in constant time,
 * preventing timing attacks on sensitive data comparisons.
 *
 * @param a First memory region
 * @param b Second memory region
 * @param len Number of bytes to compare
 * @return 0 if equal, non-zero if different
 */
int fabric_secure_memcmp(const void *a, const void *b, size_t len);

/**
 * Secure memory copy with bounds checking.
 * This function performs a safe memory copy with explicit bounds checking.
 *
 * @param dest Destination buffer
 * @param dest_size Size of destination buffer
 * @param src Source buffer
 * @param src_size Number of bytes to copy
 * @return FABRIC_SUCCESS on success, error code on failure
 */
FabricError fabric_secure_memcpy(void *dest, size_t dest_size,
                                 const void *src, size_t src_size);

/**
 * Lock memory pages to prevent swapping.
 * This prevents sensitive data from being written to swap files.
 *
 * @param ptr Pointer to memory to lock
 * @param len Number of bytes to lock
 * @return FABRIC_SUCCESS on success, error code on failure
 */
FabricError fabric_secure_mlock(void *ptr, size_t len);

/**
 * Unlock previously locked memory pages.
 *
 * @param ptr Pointer to memory to unlock
 * @param len Number of bytes to unlock
 * @return FABRIC_SUCCESS on success, error code on failure
 */
FabricError fabric_secure_munlock(void *ptr, size_t len);

/**
 * Secure string duplication.
 * Creates a secure copy of a string that should be freed with fabric_secure_free().
 *
 * @param str String to duplicate
 * @return Pointer to duplicated string, or NULL on failure
 */
char *fabric_secure_strdup(const char *str);

/**
 * Get the size of a secure memory allocation.
 * This is used internally to track allocation sizes for secure freeing.
 *
 * @param ptr Pointer to allocated memory
 * @return Size of allocation, or 0 if not found
 */
size_t fabric_secure_malloc_size(void *ptr);

/**
 * Initialize the secure memory subsystem.
 * This should be called once at program startup.
 *
 * @return FABRIC_SUCCESS on success, error code on failure
 */
FabricError fabric_secure_memory_init(void);

/**
 * Cleanup the secure memory subsystem.
 * This should be called at program shutdown.
 */
void fabric_secure_memory_cleanup(void);

#endif // FABRIC_MEMORY_H
