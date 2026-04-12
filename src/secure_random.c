#include "secure_random.h"
#include <fcntl.h>
#include <unistd.h>
#include <errno.h>
#include <string.h>
#include <time.h>

// Platform-specific includes
#ifdef __linux__
#include <sys/random.h>
#endif

#ifdef __APPLE__
#include <Security/Security.h>
#endif

#ifdef _WIN32
#include <windows.h>
#include <wincrypt.h>
#endif

// Internal state
static int initialized = 0;
static int urandom_fd = -1;

#ifdef _WIN32
static HCRYPTPROV hCryptProv = 0;
#endif

FabricError fabric_secure_random_init(void)
{
  if (initialized)
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

  initialized = 1;
  return FABRIC_SUCCESS;
}

FabricError fabric_secure_random_bytes(uint8_t *buffer, size_t length)
{
  FABRIC_CHECK_NULL(buffer);
  FABRIC_CHECK_CONDITION(length > 0, FABRIC_ERROR_INVALID_SIZE);

  if (!initialized)
  {
    FabricError init_result = fabric_secure_random_init();
    if (init_result != FABRIC_SUCCESS)
    {
      return init_result;
    }
  }

#ifdef __linux__
  // Linux: Try getrandom() first (available since kernel 3.17)
  ssize_t result = getrandom(buffer, length, 0);
  if (result == (ssize_t)length)
  {
    return FABRIC_SUCCESS;
  }

  // If getrandom() fails, fall back to /dev/urandom
  if (result < 0 && errno != ENOSYS)
  {
    return FABRIC_ERROR_SYSTEM_CALL_FAILED;
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
  if (!initialized)
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

  initialized = 0;
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

  // Fail if more than 5% of bytes are consecutive duplicates
  if (max_consecutive > (test_size * 0.05))
  {
    return FABRIC_ERROR_CRYPTO_INIT_FAILED;
  }

  return FABRIC_SUCCESS;
}
