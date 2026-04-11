#include "validation.h"
#include <string.h>
#include <ctype.h>
#include <stdlib.h>
#include <errno.h>
#include <limits.h>

// Platform-specific includes for network validation
#ifdef _WIN32
#include <winsock2.h>
#include <ws2tcpip.h>
#else
#include <sys/socket.h>
#include <netinet/in.h>
#include <arpa/inet.h>
#endif

// Internal state
static int validation_initialized = 0;

FabricError fabric_validation_init(void)
{
  if (validation_initialized)
  {
    return FABRIC_SUCCESS;
  }

#ifdef _WIN32
  // Initialize Winsock for network validation on Windows
  WSADATA wsaData;
  if (WSAStartup(MAKEWORD(2, 2), &wsaData) != 0)
  {
    return FABRIC_ERROR_SYSTEM_CALL_FAILED;
  }
#endif

  validation_initialized = 1;
  return FABRIC_SUCCESS;
}

void fabric_validation_cleanup(void)
{
  if (!validation_initialized)
  {
    return;
  }

#ifdef _WIN32
  WSACleanup();
#endif

  validation_initialized = 0;
}

/* ========================================================================
 * CRYPTOGRAPHIC INPUT VALIDATION
 * ======================================================================== */

FabricError fabric_validate_private_key(const uint8_t *privkey, size_t len)
{
  FABRIC_CHECK_NULL(privkey);

  if (len != FABRIC_PRIVATE_KEY_SIZE)
  {
    return FABRIC_ERROR_INVALID_KEY;
  }

  // Check for all-zero key (invalid)
  int all_zero = 1;
  for (size_t i = 0; i < len; i++)
  {
    if (privkey[i] != 0)
    {
      all_zero = 0;
      break;
    }
  }

  if (all_zero)
  {
    return FABRIC_ERROR_INVALID_KEY;
  }

  // Check for all-FF key (invalid for secp256k1)
  int all_ff = 1;
  for (size_t i = 0; i < len; i++)
  {
    if (privkey[i] != 0xFF)
    {
      all_ff = 0;
      break;
    }
  }

  if (all_ff)
  {
    return FABRIC_ERROR_INVALID_KEY;
  }

  return FABRIC_SUCCESS;
}

FabricError fabric_validate_public_key(const uint8_t *pubkey, size_t len)
{
  FABRIC_CHECK_NULL(pubkey);

  if (len != FABRIC_PUBLIC_KEY_SIZE)
  {
    return FABRIC_ERROR_INVALID_KEY;
  }

  // Check for valid compressed public key prefix (0x02 or 0x03)
  if (pubkey[0] != 0x02 && pubkey[0] != 0x03)
  {
    return FABRIC_ERROR_INVALID_KEY;
  }

  // Check for all-zero key (invalid)
  int all_zero = 1;
  for (size_t i = 1; i < len; i++)
  {
    if (pubkey[i] != 0)
    {
      all_zero = 0;
      break;
    }
  }

  if (all_zero)
  {
    return FABRIC_ERROR_INVALID_KEY;
  }

  return FABRIC_SUCCESS;
}

FabricError fabric_validate_signature(const uint8_t *sig, size_t len)
{
  FABRIC_CHECK_NULL(sig);

  if (len != FABRIC_SIGNATURE_SIZE)
  {
    return FABRIC_ERROR_INVALID_SIGNATURE;
  }

  // Check for all-zero signature (invalid)
  int all_zero = 1;
  for (size_t i = 0; i < len; i++)
  {
    if (sig[i] != 0)
    {
      all_zero = 0;
      break;
    }
  }

  if (all_zero)
  {
    return FABRIC_ERROR_INVALID_SIGNATURE;
  }

  return FABRIC_SUCCESS;
}

FabricError fabric_validate_hash(const uint8_t *hash, size_t len)
{
  FABRIC_CHECK_NULL(hash);

  if (len != FABRIC_HASH_SIZE)
  {
    return FABRIC_ERROR_INVALID_SIZE;
  }

  return FABRIC_SUCCESS;
}

/* ========================================================================
 * NETWORK INPUT VALIDATION
 * ======================================================================== */

FabricError fabric_validate_ipv4_address(const char *ip_str)
{
  FABRIC_CHECK_NULL(ip_str);

  struct sockaddr_in sa;
  int result = inet_pton(AF_INET, ip_str, &(sa.sin_addr));

  if (result != 1)
  {
    return FABRIC_ERROR_INVALID_ADDRESS;
  }

  return FABRIC_SUCCESS;
}

FabricError fabric_validate_ipv6_address(const char *ip_str)
{
  FABRIC_CHECK_NULL(ip_str);

  struct sockaddr_in6 sa;
  int result = inet_pton(AF_INET6, ip_str, &(sa.sin6_addr));

  if (result != 1)
  {
    return FABRIC_ERROR_INVALID_ADDRESS;
  }

  return FABRIC_SUCCESS;
}

FabricError fabric_validate_ip_address(const char *ip_str)
{
  FABRIC_CHECK_NULL(ip_str);

  // Try IPv4 first
  if (fabric_validate_ipv4_address(ip_str) == FABRIC_SUCCESS)
  {
    return FABRIC_SUCCESS;
  }

  // Try IPv6
  if (fabric_validate_ipv6_address(ip_str) == FABRIC_SUCCESS)
  {
    return FABRIC_SUCCESS;
  }

  return FABRIC_ERROR_INVALID_ADDRESS;
}

FabricError fabric_validate_port(int port, bool allow_privileged)
{
  if (port < FABRIC_MIN_PORT || port > FABRIC_MAX_PORT)
  {
    return FABRIC_ERROR_INVALID_ARGUMENT;
  }

  if (!allow_privileged && port < FABRIC_MIN_UNPRIVILEGED_PORT)
  {
    return FABRIC_ERROR_PERMISSION_DENIED;
  }

  return FABRIC_SUCCESS;
}

FabricError fabric_validate_peer_id(const char *peer_id)
{
  FABRIC_CHECK_NULL(peer_id);

  size_t len = strlen(peer_id);
  if (len == 0 || len > FABRIC_MAX_PEER_ID_LENGTH)
  {
    return FABRIC_ERROR_INVALID_ARGUMENT;
  }

  // Check for safe characters only (alphanumeric, underscore, hyphen)
  for (size_t i = 0; i < len; i++)
  {
    char c = peer_id[i];
    if (!isalnum(c) && c != '_' && c != '-' && c != '.')
    {
      return FABRIC_ERROR_INVALID_ARGUMENT;
    }
  }

  return FABRIC_SUCCESS;
}

FabricError fabric_validate_hostname(const char *hostname)
{
  FABRIC_CHECK_NULL(hostname);

  size_t len = strlen(hostname);
  if (len == 0 || len > FABRIC_MAX_HOSTNAME_LENGTH)
  {
    return FABRIC_ERROR_INVALID_ARGUMENT;
  }

  // Basic hostname validation
  for (size_t i = 0; i < len; i++)
  {
    char c = hostname[i];
    if (!isalnum(c) && c != '-' && c != '.')
    {
      return FABRIC_ERROR_INVALID_ARGUMENT;
    }
  }

  // Hostname cannot start or end with hyphen or dot
  if (hostname[0] == '-' || hostname[0] == '.' ||
      hostname[len - 1] == '-' || hostname[len - 1] == '.')
  {
    return FABRIC_ERROR_INVALID_ARGUMENT;
  }

  return FABRIC_SUCCESS;
}

/* ========================================================================
 * MESSAGE AND DATA VALIDATION
 * ======================================================================== */

FabricError fabric_validate_message_size(uint32_t size)
{
  if (size == 0 || size > FABRIC_MAX_MESSAGE_SIZE)
  {
    return FABRIC_ERROR_INVALID_SIZE;
  }

  return FABRIC_SUCCESS;
}

FabricError fabric_validate_message_type(uint32_t type)
{
  // Define valid message type ranges
  // Based on the protocol specification
  if (type >= 128 && type <= 1024)
  {
    return FABRIC_SUCCESS;
  }

  return FABRIC_ERROR_MESSAGE_INVALID_TYPE;
}

FabricError fabric_validate_file_path(const char *path)
{
  FABRIC_CHECK_NULL(path);

  size_t len = strlen(path);
  if (len == 0 || len > FABRIC_MAX_PATH_LENGTH)
  {
    return FABRIC_ERROR_INVALID_ARGUMENT;
  }

  // Check for dangerous path sequences
  if (strstr(path, "../") != NULL || strstr(path, "..\\") != NULL)
  {
    return FABRIC_ERROR_INVALID_ARGUMENT;
  }

  // Check for null bytes
  for (size_t i = 0; i < len; i++)
  {
    if (path[i] == '\0')
    {
      return FABRIC_ERROR_INVALID_ARGUMENT;
    }
  }

  return FABRIC_SUCCESS;
}

/* ========================================================================
 * SAFE BUFFER OPERATIONS
 * ======================================================================== */

FabricError fabric_safe_buffer_copy(void *dest, size_t dest_size,
                                   const void *src, size_t src_size)
{
  FABRIC_CHECK_NULL(dest);
  FABRIC_CHECK_NULL(src);
  FABRIC_CHECK_CONDITION(dest_size > 0, FABRIC_ERROR_INVALID_SIZE);
  FABRIC_CHECK_CONDITION(src_size > 0, FABRIC_ERROR_INVALID_SIZE);
  FABRIC_CHECK_CONDITION(src_size <= dest_size, FABRIC_ERROR_BUFFER_TOO_SMALL);

  memcpy(dest, src, src_size);

  // Zero remaining bytes if destination is larger
  if (dest_size > src_size)
  {
    memset((uint8_t *)dest + src_size, 0, dest_size - src_size);
  }

  return FABRIC_SUCCESS;
}

FabricError fabric_safe_string_concat(char *dest, size_t dest_size, const char *src)
{
  FABRIC_CHECK_NULL(dest);
  FABRIC_CHECK_NULL(src);
  FABRIC_CHECK_CONDITION(dest_size > 0, FABRIC_ERROR_INVALID_SIZE);

  size_t dest_len = strnlen(dest, dest_size);
  if (dest_len == dest_size)
  {
    return FABRIC_ERROR_BUFFER_TOO_SMALL; // dest not null-terminated
  }

  size_t src_len = strlen(src);
  size_t available = dest_size - dest_len - 1; // -1 for null terminator

  if (src_len > available)
  {
    return FABRIC_ERROR_BUFFER_TOO_SMALL;
  }

  strncat(dest, src, src_len);
  return FABRIC_SUCCESS;
}

FabricError fabric_safe_string_copy(char *dest, size_t dest_size, const char *src)
{
  FABRIC_CHECK_NULL(dest);
  FABRIC_CHECK_NULL(src);
  FABRIC_CHECK_CONDITION(dest_size > 0, FABRIC_ERROR_INVALID_SIZE);

  size_t src_len = strlen(src);
  if (src_len >= dest_size)
  {
    return FABRIC_ERROR_BUFFER_TOO_SMALL;
  }

  strcpy(dest, src);
  return FABRIC_SUCCESS;
}

FabricError fabric_safe_parse_int(const char *str, int *result, int min_value, int max_value)
{
  FABRIC_CHECK_NULL(str);
  FABRIC_CHECK_NULL(result);
  FABRIC_CHECK_CONDITION(min_value <= max_value, FABRIC_ERROR_INVALID_ARGUMENT);

  char *endptr;
  errno = 0;
  long parsed = strtol(str, &endptr, 10);

  if (errno == ERANGE || parsed < INT_MIN || parsed > INT_MAX)
  {
    return FABRIC_ERROR_INVALID_ARGUMENT;
  }

  if (endptr == str || *endptr != '\0')
  {
    return FABRIC_ERROR_INVALID_ARGUMENT; // No digits found or trailing characters
  }

  int value = (int)parsed;
  if (value < min_value || value > max_value)
  {
    return FABRIC_ERROR_INVALID_ARGUMENT;
  }

  *result = value;
  return FABRIC_SUCCESS;
}

FabricError fabric_safe_parse_uint(const char *str, unsigned int *result, unsigned int max_value)
{
  FABRIC_CHECK_NULL(str);
  FABRIC_CHECK_NULL(result);

  char *endptr;
  errno = 0;
  unsigned long parsed = strtoul(str, &endptr, 10);

  if (errno == ERANGE || parsed > UINT_MAX)
  {
    return FABRIC_ERROR_INVALID_ARGUMENT;
  }

  if (endptr == str || *endptr != '\0')
  {
    return FABRIC_ERROR_INVALID_ARGUMENT; // No digits found or trailing characters
  }

  unsigned int value = (unsigned int)parsed;
  if (value > max_value)
  {
    return FABRIC_ERROR_INVALID_ARGUMENT;
  }

  *result = value;
  return FABRIC_SUCCESS;
}

/* ========================================================================
 * STRING VALIDATION AND SANITIZATION
 * ======================================================================== */

FabricError fabric_validate_safe_string(const char *str, size_t max_length)
{
  FABRIC_CHECK_NULL(str);

  size_t len = strlen(str);
  if (len > max_length)
  {
    return FABRIC_ERROR_INVALID_SIZE;
  }

  // Check for control characters and null bytes
  for (size_t i = 0; i < len; i++)
  {
    unsigned char c = (unsigned char)str[i];

    // Allow printable ASCII and common whitespace
    if (c < 32 && c != '\t' && c != '\n' && c != '\r')
    {
      return FABRIC_ERROR_INVALID_ARGUMENT;
    }

    // Reject DEL character
    if (c == 127)
    {
      return FABRIC_ERROR_INVALID_ARGUMENT;
    }
  }

  return FABRIC_SUCCESS;
}

FabricError fabric_validate_printable_string(const char *str, size_t max_length)
{
  FABRIC_CHECK_NULL(str);

  size_t len = strlen(str);
  if (len > max_length)
  {
    return FABRIC_ERROR_INVALID_SIZE;
  }

  // Check for printable ASCII characters only
  for (size_t i = 0; i < len; i++)
  {
    unsigned char c = (unsigned char)str[i];
    if (c < 32 || c > 126)
    {
      return FABRIC_ERROR_INVALID_ARGUMENT;
    }
  }

  return FABRIC_SUCCESS;
}

FabricError fabric_validate_alphanumeric_string(const char *str, size_t max_length)
{
  FABRIC_CHECK_NULL(str);

  size_t len = strlen(str);
  if (len > max_length)
  {
    return FABRIC_ERROR_INVALID_SIZE;
  }

  // Allow alphanumeric, underscore, hyphen, and period
  for (size_t i = 0; i < len; i++)
  {
    char c = str[i];
    if (!isalnum(c) && c != '_' && c != '-' && c != '.')
    {
      return FABRIC_ERROR_INVALID_ARGUMENT;
    }
  }

  return FABRIC_SUCCESS;
}

FabricError fabric_sanitize_string(char *dest, size_t dest_size,
                                  const char *src, char replacement)
{
  FABRIC_CHECK_NULL(dest);
  FABRIC_CHECK_NULL(src);
  FABRIC_CHECK_CONDITION(dest_size > 0, FABRIC_ERROR_INVALID_SIZE);

  size_t src_len = strlen(src);
  if (src_len >= dest_size)
  {
    return FABRIC_ERROR_BUFFER_TOO_SMALL;
  }

  for (size_t i = 0; i < src_len; i++)
  {
    unsigned char c = (unsigned char)src[i];

    // Replace dangerous characters
    if (c < 32 || c == 127)
    {
      dest[i] = replacement;
    }
    else
    {
      dest[i] = src[i];
    }
  }

  dest[src_len] = '\0';
  return FABRIC_SUCCESS;
}
