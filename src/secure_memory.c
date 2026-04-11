#include "secure_memory.h"
#include <stdlib.h>
#include <string.h>
#include <stdint.h>

// Platform-specific includes
#ifdef _WIN32
#include <windows.h>
#else
#include <sys/mman.h>
#include <unistd.h>
#endif

// Internal allocation tracking for secure free operations
typedef struct allocation_record
{
  void *ptr;
  size_t size;
  struct allocation_record *next;
} allocation_record_t;

static allocation_record_t *allocations = NULL;
static int memory_initialized = 0;

// Platform-specific secure zero implementation
#ifdef _WIN32
#define SECURE_ZERO_IMPL(ptr, len) SecureZeroMemory((ptr), (len))
#else
// Use volatile to prevent compiler optimization
static void secure_zero_impl(volatile void *ptr, size_t len)
{
  volatile uint8_t *p = (volatile uint8_t *)ptr;
  for (size_t i = 0; i < len; i++)
  {
    p[i] = 0;
  }
  // Memory barrier to prevent reordering
  __asm__ __volatile__("" : : "r"(ptr) : "memory");
}
#define SECURE_ZERO_IMPL(ptr, len) secure_zero_impl((ptr), (len))
#endif

FabricError fabric_secure_memory_init(void)
{
  if (memory_initialized)
  {
    return FABRIC_SUCCESS;
  }

  allocations = NULL;
  memory_initialized = 1;
  return FABRIC_SUCCESS;
}

void fabric_secure_memory_cleanup(void)
{
  if (!memory_initialized)
  {
    return;
  }

  // Clean up any remaining allocations
  allocation_record_t *current = allocations;
  while (current)
  {
    allocation_record_t *next = current->next;

    // Securely zero the tracked memory
    SECURE_ZERO_IMPL(current->ptr, current->size);
    free(current->ptr);
    free(current);

    current = next;
  }

  allocations = NULL;
  memory_initialized = 0;
}

static void track_allocation(void *ptr, size_t size)
{
  if (!ptr || size == 0)
    return;

  allocation_record_t *record = malloc(sizeof(allocation_record_t));
  if (!record)
    return; // Unable to track, but don't fail the allocation

  record->ptr = ptr;
  record->size = size;
  record->next = allocations;
  allocations = record;
}

static size_t untrack_allocation(void *ptr)
{
  if (!ptr)
    return 0;

  allocation_record_t **current = &allocations;
  while (*current)
  {
    if ((*current)->ptr == ptr)
    {
      allocation_record_t *to_remove = *current;
      size_t size = to_remove->size;
      *current = to_remove->next;
      free(to_remove);
      return size;
    }
    current = &(*current)->next;
  }

  return 0; // Not found
}

void fabric_secure_zero(volatile void *ptr, size_t len)
{
  if (!ptr || len == 0)
    return;

  SECURE_ZERO_IMPL(ptr, len);
}

void *fabric_secure_malloc(size_t size)
{
  if (size == 0)
    return NULL;

  if (!memory_initialized)
  {
    fabric_secure_memory_init();
  }

  void *ptr = malloc(size);
  if (!ptr)
    return NULL;

  // Zero initialize
  memset(ptr, 0, size);

  // Track the allocation
  track_allocation(ptr, size);

  return ptr;
}

void fabric_secure_free(void *ptr, size_t size)
{
  if (!ptr)
    return;

  // If size is 0, try to get it from tracking
  if (size == 0)
  {
    size = untrack_allocation(ptr);
  }
  else
  {
    untrack_allocation(ptr);
  }

  // Securely zero the memory
  if (size > 0)
  {
    SECURE_ZERO_IMPL(ptr, size);
  }

  free(ptr);
}

void *fabric_secure_realloc(void *ptr, size_t old_size, size_t new_size)
{
  if (new_size == 0)
  {
    fabric_secure_free(ptr, old_size);
    return NULL;
  }

  if (!ptr)
  {
    return fabric_secure_malloc(new_size);
  }

  void *new_ptr = fabric_secure_malloc(new_size);
  if (!new_ptr)
  {
    return NULL; // Original memory is unchanged
  }

  // Copy the minimum of old and new sizes
  size_t copy_size = (old_size < new_size) ? old_size : new_size;
  memcpy(new_ptr, ptr, copy_size);

  // Securely free the old memory
  fabric_secure_free(ptr, old_size);

  return new_ptr;
}

int fabric_secure_memcmp(const void *a, const void *b, size_t len)
{
  if (!a || !b)
  {
    return (a == b) ? 0 : 1;
  }

  const uint8_t *pa = (const uint8_t *)a;
  const uint8_t *pb = (const uint8_t *)b;
  uint8_t result = 0;

  // Constant-time comparison
  for (size_t i = 0; i < len; i++)
  {
    result |= pa[i] ^ pb[i];
  }

  return result;
}

FabricError fabric_secure_memcpy(void *dest, size_t dest_size,
                                 const void *src, size_t src_size)
{
  FABRIC_CHECK_NULL(dest);
  FABRIC_CHECK_NULL(src);
  FABRIC_CHECK_CONDITION(dest_size > 0, FABRIC_ERROR_INVALID_SIZE);
  FABRIC_CHECK_CONDITION(src_size > 0, FABRIC_ERROR_INVALID_SIZE);
  FABRIC_CHECK_CONDITION(src_size <= dest_size, FABRIC_ERROR_BUFFER_TOO_SMALL);

  memcpy(dest, src, src_size);

  // Zero remaining bytes if dest is larger
  if (dest_size > src_size)
  {
    memset((uint8_t *)dest + src_size, 0, dest_size - src_size);
  }

  return FABRIC_SUCCESS;
}

FabricError fabric_secure_mlock(void *ptr, size_t len)
{
  FABRIC_CHECK_NULL(ptr);
  FABRIC_CHECK_CONDITION(len > 0, FABRIC_ERROR_INVALID_SIZE);

#ifdef _WIN32
  if (!VirtualLock(ptr, len))
  {
    return FABRIC_ERROR_SYSTEM_CALL_FAILED;
  }
#else
  if (mlock(ptr, len) != 0)
  {
    return FABRIC_ERROR_SYSTEM_CALL_FAILED;
  }
#endif

  return FABRIC_SUCCESS;
}

FabricError fabric_secure_munlock(void *ptr, size_t len)
{
  FABRIC_CHECK_NULL(ptr);
  FABRIC_CHECK_CONDITION(len > 0, FABRIC_ERROR_INVALID_SIZE);

#ifdef _WIN32
  if (!VirtualUnlock(ptr, len))
  {
    return FABRIC_ERROR_SYSTEM_CALL_FAILED;
  }
#else
  if (munlock(ptr, len) != 0)
  {
    return FABRIC_ERROR_SYSTEM_CALL_FAILED;
  }
#endif

  return FABRIC_SUCCESS;
}

char *fabric_secure_strdup(const char *str)
{
  if (!str)
    return NULL;

  size_t len = strlen(str) + 1;
  char *dup = fabric_secure_malloc(len);
  if (!dup)
    return NULL;

  memcpy(dup, str, len);
  return dup;
}

size_t fabric_secure_malloc_size(void *ptr)
{
  if (!ptr)
    return 0;

  allocation_record_t *current = allocations;
  while (current)
  {
    if (current->ptr == ptr)
    {
      return current->size;
    }
    current = current->next;
  }

  return 0; // Not found
}
