#ifndef ERRORS_H
#define ERRORS_H

#include <stdint.h>
#include <stddef.h>

// Error code definitions
typedef enum
{
  FABRIC_SUCCESS = 0,

  // General errors (1000-1999)
  FABRIC_ERROR_NULL_POINTER = 1000,
  FABRIC_ERROR_INVALID_ARGUMENT = 1001,
  FABRIC_ERROR_OUT_OF_MEMORY = 1002,
  FABRIC_ERROR_BUFFER_TOO_SMALL = 1003,
  FABRIC_ERROR_INVALID_SIZE = 1004,
  FABRIC_ERROR_TIMEOUT = 1005,
  FABRIC_ERROR_OPERATION_FAILED = 1006,

  // Cryptographic errors (2000-2999)
  FABRIC_ERROR_CRYPTO_INIT_FAILED = 2000,
  FABRIC_ERROR_KEY_GENERATION_FAILED = 2001,
  FABRIC_ERROR_SIGNATURE_FAILED = 2002,
  FABRIC_ERROR_VERIFICATION_FAILED = 2003,
  FABRIC_ERROR_HASH_COMPUTATION_FAILED = 2004,
  FABRIC_ERROR_INVALID_KEY = 2005,
  FABRIC_ERROR_INVALID_SIGNATURE = 2006,

  // Network errors (3000-3999)
  FABRIC_ERROR_NETWORK_INIT_FAILED = 3000,
  FABRIC_ERROR_SOCKET_CREATE_FAILED = 3001,
  FABRIC_ERROR_SOCKET_BIND_FAILED = 3002,
  FABRIC_ERROR_SOCKET_CONNECT_FAILED = 3003,
  FABRIC_ERROR_SOCKET_ACCEPT_FAILED = 3004,
  FABRIC_ERROR_SOCKET_SEND_FAILED = 3005,
  FABRIC_ERROR_SOCKET_RECV_FAILED = 3006,
  FABRIC_ERROR_CONNECTION_CLOSED = 3007,
  FABRIC_ERROR_CONNECTION_TIMEOUT = 3008,
  FABRIC_ERROR_CONNECTION_REFUSED = 3009,
  FABRIC_ERROR_INVALID_ADDRESS = 3010,
  FABRIC_ERROR_PORT_IN_USE = 3011,

  // NOISE protocol errors (4000-4999)
  FABRIC_ERROR_NOISE_INIT_FAILED = 4000,
  FABRIC_ERROR_NOISE_HANDSHAKE_FAILED = 4001,
  FABRIC_ERROR_NOISE_WRITE_FAILED = 4002,
  FABRIC_ERROR_NOISE_READ_FAILED = 4003,
  FABRIC_ERROR_NOISE_SPLIT_FAILED = 4004,
  FABRIC_ERROR_NOISE_PROTOCOL_MISMATCH = 4005,

  // Message errors (5000-5999)
  FABRIC_ERROR_MESSAGE_INVALID_FORMAT = 5000,
  FABRIC_ERROR_MESSAGE_TOO_LARGE = 5001,
  FABRIC_ERROR_MESSAGE_SERIALIZATION_FAILED = 5002,
  FABRIC_ERROR_MESSAGE_DESERIALIZATION_FAILED = 5003,
  FABRIC_ERROR_MESSAGE_INVALID_TYPE = 5004,
  FABRIC_ERROR_MESSAGE_INVALID_VERSION = 5005,

  // Contract errors (6000-6999)
  FABRIC_ERROR_CONTRACT_INVALID_STATE = 6000,
  FABRIC_ERROR_CONTRACT_EXPIRED = 6001,
  FABRIC_ERROR_CONTRACT_ALREADY_EXECUTED = 6002,
  FABRIC_ERROR_CONTRACT_INVALID_ACTION = 6003,
  FABRIC_ERROR_CONTRACT_INSUFFICIENT_FUNDS = 6004,
  FABRIC_ERROR_CONTRACT_DEADLINE_PASSED = 6005,

  // Peer errors (7000-7999)
  FABRIC_ERROR_PEER_INIT_FAILED = 7000,
  FABRIC_ERROR_PEER_CONNECTION_LIMIT = 7001,
  FABRIC_ERROR_PEER_INVALID_CONNECTION = 7002,
  FABRIC_ERROR_PEER_KEYPAIR_GENERATION_FAILED = 7003,
  FABRIC_ERROR_PEER_INVALID_KEYPAIR = 7004,
  FABRIC_ERROR_PEER_ALREADY_LISTENING = 7005,
  FABRIC_ERROR_ALREADY_EXISTS = 7006,
  FABRIC_ERROR_NOT_FOUND = 7007,

  // System errors (8000-8999)
  FABRIC_ERROR_SYSTEM_CALL_FAILED = 8000,
  FABRIC_ERROR_FILE_OPERATION_FAILED = 8001,
  FABRIC_ERROR_PERMISSION_DENIED = 8002,
  FABRIC_ERROR_RESOURCE_UNAVAILABLE = 8003,
  FABRIC_ERROR_THREAD_CREATE_FAILED = 8004,

  // WebGPU errors (8500-8999)
  FABRIC_ERROR_WEBGPU_NOT_INITIALIZED = 8500,
  FABRIC_ERROR_WEBGPU_INIT_FAILED = 8501,
  FABRIC_ERROR_WEBGPU_NO_ADAPTER = 8502,
  FABRIC_ERROR_WEBGPU_NO_DEVICE = 8503,
  FABRIC_ERROR_WEBGPU_NO_QUEUE = 8504,
  FABRIC_ERROR_WEBGPU_BUFFER_CREATION_FAILED = 8505,
  FABRIC_ERROR_WEBGPU_BUFFER_MAP_FAILED = 8506,
  FABRIC_ERROR_WEBGPU_SHADER_CREATION_FAILED = 8507,
  FABRIC_ERROR_WEBGPU_PIPELINE_CREATION_FAILED = 8508,
  FABRIC_ERROR_WEBGPU_COMPUTE_FAILED = 8509,
  FABRIC_ERROR_BUFFER_OVERFLOW = 8510,
  FABRIC_ERROR_INVALID_INPUT = 8511,

  // Garbled circuit errors (8600-8699)
  FABRIC_ERROR_GARBLED_CIRCUIT_INVALID = 8600,
  FABRIC_ERROR_GARBLED_CIRCUIT_CREATION_FAILED = 8601,
  FABRIC_ERROR_GARBLED_CIRCUIT_EVALUATION_FAILED = 8602,
  FABRIC_ERROR_WIRE_LABEL_GENERATION_FAILED = 8603,
  FABRIC_ERROR_GATE_ENCRYPTION_FAILED = 8604,
  FABRIC_ERROR_GATE_DECRYPTION_FAILED = 8605,

  // Internal errors (9000-9999)
  FABRIC_ERROR_INTERNAL_STATE_CORRUPTION = 9000,
  FABRIC_ERROR_UNEXPECTED_CONDITION = 9001,
  FABRIC_ERROR_NOT_IMPLEMENTED = 9002,
  FABRIC_ERROR_DEPRECATED_FUNCTION = 9003,
  FABRIC_ERROR_UNSUPPORTED_MESSAGE_TYPE = 9004
} FabricError;

// Error context structure for detailed error information
typedef struct
{
  FabricError code;
  const char *function;
  const char *file;
  int line;
  const char *message;
  int system_errno; // For system call errors
} FabricErrorContext;

// Error handling functions
const char *fabric_error_to_string(FabricError error);
const char *fabric_error_get_message(FabricError error);
int fabric_error_is_critical(FabricError error);
int fabric_error_is_recoverable(FabricError error);

// Error context functions
void fabric_error_set_context(FabricErrorContext *ctx, FabricError code,
                              const char *function, const char *file, int line,
                              const char *message, int system_errno);
void fabric_error_print_context(const FabricErrorContext *ctx);

// Error checking macros
#define FABRIC_CHECK_NULL(ptr)          \
  do                                    \
  {                                     \
    if (!(ptr))                         \
    {                                   \
      return FABRIC_ERROR_NULL_POINTER; \
    }                                   \
  } while (0)

#define FABRIC_CHECK_NULL_VOID(ptr) \
  do                                \
  {                                 \
    if (!(ptr))                     \
    {                               \
      return;                       \
    }                               \
  } while (0)

#define FABRIC_CHECK_SIZE(size, max_size) \
  do                                      \
  {                                       \
    if ((size) > (max_size))              \
    {                                     \
      return FABRIC_ERROR_INVALID_SIZE;   \
    }                                     \
  } while (0)

#define FABRIC_CHECK_CONDITION(cond, error_code) \
  do                                             \
  {                                              \
    if (!(cond))                                 \
    {                                            \
      return (error_code);                       \
    }                                            \
  } while (0)

#define FABRIC_RETURN_ON_ERROR(result) \
  do                                   \
  {                                    \
    FabricError __result = (result);   \
    if (__result != FABRIC_SUCCESS)    \
    {                                  \
      return __result;                 \
    }                                  \
  } while (0)

#define FABRIC_GOTO_ON_ERROR(result, label) \
  do                                        \
  {                                         \
    FabricError __result = (result);        \
    if (__result != FABRIC_SUCCESS)         \
    {                                       \
      goto label;                           \
    }                                       \
  } while (0)

// Error logging macro
#define FABRIC_LOG_ERROR(error_code, message) \
  fabric_log_error(error_code, __func__, __FILE__, __LINE__, message)

// Function to log errors (implementation in errors.c)
void fabric_log_error(FabricError error, const char *function,
                      const char *file, int line, const char *message);

// Convert system errno to FabricError
FabricError fabric_error_from_errno(int err);

#endif // ERRORS_H
