#include "errors.h"
#include <stdio.h>
#include <string.h>
#include <errno.h>

// Error message strings
static const char *error_messages[] = {
    [FABRIC_SUCCESS] = "Success",

    // General errors
    [FABRIC_ERROR_NULL_POINTER] = "Null pointer provided",
    [FABRIC_ERROR_INVALID_ARGUMENT] = "Invalid argument provided",
    [FABRIC_ERROR_OUT_OF_MEMORY] = "Out of memory",
    [FABRIC_ERROR_BUFFER_TOO_SMALL] = "Buffer too small",
    [FABRIC_ERROR_INVALID_SIZE] = "Invalid size specified",
    [FABRIC_ERROR_TIMEOUT] = "Operation timed out",
    [FABRIC_ERROR_OPERATION_FAILED] = "Operation failed",

    // Cryptographic errors
    [FABRIC_ERROR_CRYPTO_INIT_FAILED] = "Cryptographic initialization failed",
    [FABRIC_ERROR_KEY_GENERATION_FAILED] = "Key generation failed",
    [FABRIC_ERROR_SIGNATURE_FAILED] = "Signature creation failed",
    [FABRIC_ERROR_VERIFICATION_FAILED] = "Signature verification failed",
    [FABRIC_ERROR_HASH_COMPUTATION_FAILED] = "Hash computation failed",
    [FABRIC_ERROR_INVALID_KEY] = "Invalid cryptographic key",
    [FABRIC_ERROR_INVALID_SIGNATURE] = "Invalid signature",

    // Network errors
    [FABRIC_ERROR_NETWORK_INIT_FAILED] = "Network initialization failed",
    [FABRIC_ERROR_SOCKET_CREATE_FAILED] = "Socket creation failed",
    [FABRIC_ERROR_SOCKET_BIND_FAILED] = "Socket bind failed",
    [FABRIC_ERROR_SOCKET_CONNECT_FAILED] = "Socket connection failed",
    [FABRIC_ERROR_SOCKET_ACCEPT_FAILED] = "Socket accept failed",
    [FABRIC_ERROR_SOCKET_SEND_FAILED] = "Socket send failed",
    [FABRIC_ERROR_SOCKET_RECV_FAILED] = "Socket receive failed",
    [FABRIC_ERROR_CONNECTION_CLOSED] = "Connection closed",
    [FABRIC_ERROR_CONNECTION_TIMEOUT] = "Connection timeout",
    [FABRIC_ERROR_CONNECTION_REFUSED] = "Connection refused",
    [FABRIC_ERROR_INVALID_ADDRESS] = "Invalid address",
    [FABRIC_ERROR_PORT_IN_USE] = "Port already in use",

    // NOISE protocol errors
    [FABRIC_ERROR_NOISE_INIT_FAILED] = "NOISE protocol initialization failed",
    [FABRIC_ERROR_NOISE_HANDSHAKE_FAILED] = "NOISE handshake failed",
    [FABRIC_ERROR_NOISE_WRITE_FAILED] = "NOISE write operation failed",
    [FABRIC_ERROR_NOISE_READ_FAILED] = "NOISE read operation failed",
    [FABRIC_ERROR_NOISE_SPLIT_FAILED] = "NOISE split operation failed",
    [FABRIC_ERROR_NOISE_PROTOCOL_MISMATCH] = "NOISE protocol mismatch",

    // Message errors
    [FABRIC_ERROR_MESSAGE_INVALID_FORMAT] = "Invalid message format",
    [FABRIC_ERROR_MESSAGE_TOO_LARGE] = "Message too large",
    [FABRIC_ERROR_MESSAGE_SERIALIZATION_FAILED] = "Message serialization failed",
    [FABRIC_ERROR_MESSAGE_DESERIALIZATION_FAILED] = "Message deserialization failed",
    [FABRIC_ERROR_MESSAGE_INVALID_TYPE] = "Invalid message type",
    [FABRIC_ERROR_MESSAGE_INVALID_VERSION] = "Invalid message version",

    // Contract errors
    [FABRIC_ERROR_CONTRACT_INVALID_STATE] = "Invalid contract state",
    [FABRIC_ERROR_CONTRACT_EXPIRED] = "Contract expired",
    [FABRIC_ERROR_CONTRACT_ALREADY_EXECUTED] = "Contract already executed",
    [FABRIC_ERROR_CONTRACT_INVALID_ACTION] = "Invalid contract action",
    [FABRIC_ERROR_CONTRACT_INSUFFICIENT_FUNDS] = "Insufficient funds",
    [FABRIC_ERROR_CONTRACT_DEADLINE_PASSED] = "Contract deadline passed",

    // Peer errors
    [FABRIC_ERROR_PEER_INIT_FAILED] = "Peer initialization failed",
    [FABRIC_ERROR_PEER_CONNECTION_LIMIT] = "Connection limit reached",
    [FABRIC_ERROR_PEER_INVALID_CONNECTION] = "Invalid connection",
    [FABRIC_ERROR_PEER_KEYPAIR_GENERATION_FAILED] = "Keypair generation failed",
    [FABRIC_ERROR_PEER_INVALID_KEYPAIR] = "Invalid keypair",

    // System errors
    [FABRIC_ERROR_SYSTEM_CALL_FAILED] = "System call failed",
    [FABRIC_ERROR_FILE_OPERATION_FAILED] = "File operation failed",
    [FABRIC_ERROR_PERMISSION_DENIED] = "Permission denied",
    [FABRIC_ERROR_RESOURCE_UNAVAILABLE] = "Resource unavailable",

    // Internal errors
    [FABRIC_ERROR_INTERNAL_STATE_CORRUPTION] = "Internal state corruption",
    [FABRIC_ERROR_UNEXPECTED_CONDITION] = "Unexpected condition",
    [FABRIC_ERROR_NOT_IMPLEMENTED] = "Function not implemented",
    [FABRIC_ERROR_DEPRECATED_FUNCTION] = "Function deprecated"};

const char *fabric_error_to_string(FabricError error)
{
  if (error >= 0 && error < (int)(sizeof(error_messages) / sizeof(error_messages[0])))
  {
    return error_messages[error];
  }
  return "Unknown error";
}

const char *fabric_error_get_message(FabricError error)
{
  return fabric_error_to_string(error);
}

int fabric_error_is_critical(FabricError error)
{
  // Critical errors that should cause immediate termination
  switch (error)
  {
  case FABRIC_ERROR_INTERNAL_STATE_CORRUPTION:
  case FABRIC_ERROR_OUT_OF_MEMORY:
  case FABRIC_ERROR_CRYPTO_INIT_FAILED:
    return 1;
  default:
    return 0;
  }
}

int fabric_error_is_recoverable(FabricError error)
{
  // Recoverable errors that can be retried
  switch (error)
  {
  case FABRIC_ERROR_TIMEOUT:
  case FABRIC_ERROR_CONNECTION_TIMEOUT:
  case FABRIC_ERROR_CONNECTION_REFUSED:
  case FABRIC_ERROR_PORT_IN_USE:
  case FABRIC_ERROR_SOCKET_SEND_FAILED:
  case FABRIC_ERROR_SOCKET_RECV_FAILED:
    return 1;
  default:
    return 0;
  }
}

void fabric_error_set_context(FabricErrorContext *ctx, FabricError code,
                              const char *function, const char *file, int line,
                              const char *message, int system_errno)
{
  if (ctx)
  {
    ctx->code = code;
    ctx->function = function;
    ctx->file = file;
    ctx->line = line;
    ctx->message = message;
    ctx->system_errno = system_errno;
  }
}

void fabric_error_print_context(const FabricErrorContext *ctx)
{
  if (!ctx)
  {
    return;
  }

  fprintf(stderr, "Fabric Error: %s (code: %d)\n",
          fabric_error_to_string(ctx->code), ctx->code);

  if (ctx->function)
  {
    fprintf(stderr, "Function: %s\n", ctx->function);
  }

  if (ctx->file)
  {
    fprintf(stderr, "File: %s:%d\n", ctx->file, ctx->line);
  }

  if (ctx->message)
  {
    fprintf(stderr, "Message: %s\n", ctx->message);
  }

  if (ctx->system_errno != 0)
  {
    fprintf(stderr, "System error: %s (errno: %d)\n",
            strerror(ctx->system_errno), ctx->system_errno);
  }

  fprintf(stderr, "\n");
}

void fabric_log_error(FabricError error, const char *function,
                      const char *file, int line, const char *message)
{
  FabricErrorContext ctx;
  fabric_error_set_context(&ctx, error, function, file, line, message, errno);
  fabric_error_print_context(&ctx);
}

// Helper function to convert system errno to Fabric error codes
FabricError fabric_error_from_errno(int err)
{
  switch (err)
  {
  case EAGAIN:
    return FABRIC_ERROR_TIMEOUT;
  case ECONNREFUSED:
    return FABRIC_ERROR_CONNECTION_REFUSED;
  case EADDRINUSE:
    return FABRIC_ERROR_PORT_IN_USE;
  case EINVAL:
    return FABRIC_ERROR_INVALID_ARGUMENT;
  case ENOMEM:
    return FABRIC_ERROR_OUT_OF_MEMORY;
  case EPERM:
    return FABRIC_ERROR_PERMISSION_DENIED;
  case EACCES:
    return FABRIC_ERROR_PERMISSION_DENIED;
  case ENOENT:
    return FABRIC_ERROR_FILE_OPERATION_FAILED;
  case ECONNRESET:
  case EPIPE:
    return FABRIC_ERROR_CONNECTION_CLOSED;
  default:
    return FABRIC_ERROR_SYSTEM_CALL_FAILED;
  }
}
