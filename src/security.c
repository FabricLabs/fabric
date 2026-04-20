#include "memory.h"
#include "random.h"

#include <errno.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

// Platform-specific includes
#ifdef _WIN32
#include <windows.h>
#include <wincrypt.h>
#else
#include <fcntl.h>
#include <sys/mman.h>
#include <unistd.h>
#endif

#ifdef __linux__
#include <sys/random.h>
#endif

#ifdef __APPLE__
#include <Security/Security.h>
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

/** @return 0 on success, -1 if tracking metadata could not be allocated */
static int track_allocation(void *ptr, size_t size)
{
  if (!ptr || size == 0)
    return 0;

  allocation_record_t *record = malloc(sizeof(allocation_record_t));
  if (!record)
    return -1;

  record->ptr = ptr;
  record->size = size;
  record->next = allocations;
  allocations = record;
  return 0;
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

  // Track the allocation (fail closed: untracked secure buffers are unsafe to hand out)
  if (track_allocation(ptr, size) != 0)
  {
    free(ptr);
    return NULL;
  }

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

  if (old_size == 0)
  {
    old_size = fabric_secure_malloc_size(ptr);
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

// Secure random internal state
static int random_initialized = 0;
static int urandom_fd = -1;

#ifdef _WIN32
static HCRYPTPROV hCryptProv = 0;
#endif

FabricError fabric_secure_random_init(void)
{
  if (random_initialized)
  {
    return FABRIC_SUCCESS;
  }

#ifdef _WIN32
  // Windows: Use CryptGenRandom
  if (!CryptAcquireContext(&hCryptProv, NULL, NULL, PROV_RSA_FULL, CRYPT_VERIFYCONTEXT))
  {
    return FABRIC_ERROR_CRYPTO_INIT_FAILED;
  }
#else
  // Unix-like systems: Open /dev/urandom as fallback
  urandom_fd = open("/dev/urandom", O_RDONLY);
  if (urandom_fd < 0)
  {
    return FABRIC_ERROR_SYSTEM_CALL_FAILED;
  }

  // Set FD_CLOEXEC to prevent descriptor leaking to child processes
  int flags = fcntl(urandom_fd, F_GETFD);
  if (flags >= 0)
  {
    fcntl(urandom_fd, F_SETFD, flags | FD_CLOEXEC);
  }
#endif

  random_initialized = 1;
  return FABRIC_SUCCESS;
}

FabricError fabric_secure_random_bytes(uint8_t *buffer, size_t length)
{
  FABRIC_CHECK_NULL(buffer);
  FABRIC_CHECK_CONDITION(length > 0, FABRIC_ERROR_INVALID_SIZE);

  if (!random_initialized)
  {
    FabricError init_result = fabric_secure_random_init();
    if (init_result != FABRIC_SUCCESS)
    {
      return init_result;
    }
  }

#ifdef __linux__
  // Linux: Try getrandom() first (available since kernel 3.17)
  {
    size_t offset = 0;
    while (offset < length)
    {
      ssize_t result;
      do
      {
        result = getrandom(buffer + offset, length - offset, 0);
      } while (result < 0 && errno == EINTR);

      if (result < 0)
      {
        if (errno != ENOSYS)
        {
          return FABRIC_ERROR_SYSTEM_CALL_FAILED;
        }
        break; /* fall back to /dev/urandom */
      }
      if (result == 0)
      {
        return FABRIC_ERROR_SYSTEM_CALL_FAILED;
      }
      offset += (size_t)result;
    }
    if (offset == length)
    {
      return FABRIC_SUCCESS;
    }
  }
#endif

#ifdef __APPLE__
  // macOS: Use Security framework
  OSStatus status = SecRandomCopyBytes(kSecRandomDefault, length, buffer);
  if (status == errSecSuccess)
  {
    return FABRIC_SUCCESS;
  }

  // Fall back to /dev/urandom on failure
#endif

#ifdef _WIN32
  // Windows: Use CryptGenRandom
  if (CryptGenRandom(hCryptProv, (DWORD)length, buffer))
  {
    return FABRIC_SUCCESS;
  }
  return FABRIC_ERROR_CRYPTO_INIT_FAILED;
#else
  // Unix fallback: Read from /dev/urandom
  if (urandom_fd < 0)
  {
    return FABRIC_ERROR_SYSTEM_CALL_FAILED;
  }

  size_t bytes_read = 0;
  while (bytes_read < length)
  {
    ssize_t result = read(urandom_fd, buffer + bytes_read, length - bytes_read);
    if (result < 0)
    {
      if (errno == EINTR)
      {
        continue; // Interrupted by signal, retry
      }
      return FABRIC_ERROR_SYSTEM_CALL_FAILED;
    }
    if (result == 0)
    {
      return FABRIC_ERROR_SYSTEM_CALL_FAILED; // Unexpected EOF
    }
    bytes_read += (size_t)result;
  }

  return FABRIC_SUCCESS;
#endif
}

FabricError fabric_secure_random_uint32(uint32_t *result)
{
  FABRIC_CHECK_NULL(result);

  return fabric_secure_random_bytes((uint8_t *)result, sizeof(uint32_t));
}

FabricError fabric_secure_random_range(uint32_t max_value, uint32_t *result)
{
  FABRIC_CHECK_NULL(result);
  FABRIC_CHECK_CONDITION(max_value > 0, FABRIC_ERROR_INVALID_ARGUMENT);

  if (max_value == 1)
  {
    *result = 0;
    return FABRIC_SUCCESS;
  }

  // Use rejection sampling to avoid modulo bias
  // Calculate the largest multiple of max_value that fits in uint32_t
  uint32_t threshold = UINT32_MAX - (UINT32_MAX % max_value);

  uint32_t random_value;
  int attempts = 0;
  const int max_attempts = 100; // Prevent infinite loops

  do
  {
    FabricError rand_result = fabric_secure_random_uint32(&random_value);
    if (rand_result != FABRIC_SUCCESS)
    {
      return rand_result;
    }

    attempts++;
    if (attempts > max_attempts)
    {
      return FABRIC_ERROR_OPERATION_FAILED;
    }
  } while (random_value >= threshold);

  *result = random_value % max_value;
  return FABRIC_SUCCESS;
}

void fabric_secure_random_cleanup(void)
{
  if (!random_initialized)
  {
    return;
  }

#ifdef _WIN32
  if (hCryptProv)
  {
    CryptReleaseContext(hCryptProv, 0);
    hCryptProv = 0;
  }
#else
  if (urandom_fd >= 0)
  {
    close(urandom_fd);
    urandom_fd = -1;
  }
#endif

  random_initialized = 0;
}

FabricError fabric_secure_random_test_entropy(void)
{
  enum { TEST_BYTES = 1024 };
  uint8_t test_buffer[TEST_BYTES];
  const size_t test_size = (size_t)TEST_BYTES;

  // Generate test data
  FabricError result = fabric_secure_random_bytes(test_buffer, test_size);
  if (result != FABRIC_SUCCESS)
  {
    return result;
  }

  // Simple entropy tests

  // Test 1: Check for all zeros or all ones
  int all_zero = 1, all_one = 1;
  for (size_t i = 0; i < test_size; i++)
  {
    if (test_buffer[i] != 0x00)
      all_zero = 0;
    if (test_buffer[i] != 0xFF)
      all_one = 0;
  }

  if (all_zero || all_one)
  {
    return FABRIC_ERROR_CRYPTO_INIT_FAILED;
  }

  // Test 2: Basic frequency test (should be roughly balanced)
  int bit_count = 0;
  for (size_t i = 0; i < test_size; i++)
  {
    for (int bit = 0; bit < 8; bit++)
    {
      if (test_buffer[i] & (1 << bit))
      {
        bit_count++;
      }
    }
  }

  int total_bits = test_size * 8;
  // Allow 10% deviation from 50%
  if (bit_count < (total_bits * 0.4) || bit_count > (total_bits * 0.6))
  {
    return FABRIC_ERROR_CRYPTO_INIT_FAILED;
  }

  // Test 3: Check for obvious patterns (consecutive identical bytes)
  int consecutive_count = 0;
  int max_consecutive = 0;

  for (size_t i = 1; i < test_size; i++)
  {
    if (test_buffer[i] == test_buffer[i - 1])
    {
      consecutive_count++;
    }
    else
    {
      if (consecutive_count > max_consecutive)
      {
        max_consecutive = consecutive_count;
      }
      consecutive_count = 0;
    }
  }
  if (consecutive_count > max_consecutive)
  {
    max_consecutive = consecutive_count;
  }

  // Fail if more than 5% of bytes are consecutive duplicates
  if (max_consecutive > (test_size * 0.05))
  {
    return FABRIC_ERROR_CRYPTO_INIT_FAILED;
  }

  return FABRIC_SUCCESS;
}
