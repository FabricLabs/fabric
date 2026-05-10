#include "noise.h"
#include "constants.h"
#include <unistd.h>
#include <errno.h>
#include <sys/select.h>
#include <string.h>
#include <stdio.h>
#include <sys/socket.h>
#include <netinet/in.h>
#include <netinet/tcp.h>
#include <arpa/inet.h>
#include <fcntl.h>
#ifndef MSG_NOSIGNAL
#define MSG_NOSIGNAL 0
#endif

/* Blocking write of exactly n bytes */
static ssize_t noise_write_all(int fd, const uint8_t *p, size_t n)
{
  size_t off = 0;
  while (off < n)
  {
    ssize_t s = send(fd, p + off, n - off, MSG_NOSIGNAL);
    if (s <= 0)
      return s;
    off += (size_t)s;
  }
  return (ssize_t)off;
}

/* Blocking read of exactly n bytes */
static ssize_t noise_read_all(int fd, uint8_t *p, size_t n)
{
  size_t off = 0;
  while (off < n)
  {
    ssize_t r = recv(fd, p + off, n - off, 0);
    if (r <= 0)
      return r;
    off += (size_t)r;
  }
  return (ssize_t)off;
}

/**
 * Unsigned LEB128 varint write — compatible with npm package `varint` / `length-prefixed-stream`.
 */
static int fabric_varint_write_u64(int fd, uint64_t v)
{
  uint8_t tmp[16];
  size_t n = 0;
  while (v >= 0x80u && n + 1 < sizeof(tmp))
  {
    tmp[n++] = (uint8_t)((v & 0x7fu) | 0x80u);
    v >>= 7;
  }
  if (n >= sizeof(tmp))
    return -1;
  tmp[n++] = (uint8_t)(v & 0xffu);
  return noise_write_all(fd, tmp, n) <= 0 ? -1 : 0;
}

/**
 * Unsigned LEB128 varint read — compatible with npm `varint.decode` on buffers.
 */
static int fabric_varint_read_u64_socket(int fd, uint64_t *out)
{
  uint64_t res = 0;
  int shift = 0;
  for (int i = 0; i < 10; i++)
  {
    uint8_t b;
    if (noise_read_all(fd, &b, 1) <= 0)
      return -1;
    res |= (uint64_t)(b & 0x7fu) << shift;
    if ((b & 0x80u) == 0)
    {
      *out = res;
      return 0;
    }
    shift += 7;
  }
  return -1;
}

int fabric_noise_write_frame(int fd, const uint8_t *payload, size_t len)
{
  if (len > FABRIC_NOISE_MAX_FRAME_BYTES)
    return -1;
  if (fabric_varint_write_u64(fd, (uint64_t)len) != 0)
    return -1;
  if (len > 0 && noise_write_all(fd, payload, len) <= 0)
    return -1;
  return 0;
}

int fabric_noise_read_frame(int fd, uint8_t *payload_out, size_t out_cap, size_t *out_len)
{
  uint64_t L;
  if (fabric_varint_read_u64_socket(fd, &L) != 0)
    return -1;
  if (L > FABRIC_NOISE_MAX_FRAME_BYTES || L > out_cap)
    return -1;
  if (L > 0 && noise_read_all(fd, payload_out, (size_t)L) <= 0)
    return -1;
  *out_len = (size_t)L;
  return 0;
}

void noise_get_protocol_id(NoiseAppProtocol app, NoiseProtocolId *out)
{
  if (!out)
    return;
  /* Noise XX + ChaChaPoly + SHA256 + Curve25519 — same profile as `noise-protocol-stream` WASM. */
  out->prefix_id = NOISE_PREFIX_STANDARD;
  out->pattern_id = NOISE_PATTERN_XX;
  out->cipher_id = NOISE_CIPHER_CHACHAPOLY;
  out->hash_id = NOISE_HASH_SHA256;
  out->dh_id = NOISE_DH_CURVE25519;
  (void)app;
}

const uint8_t *noise_get_prologue(NoiseAppProtocol app, size_t *out_len)
{
  static const uint8_t fabric_prologue[] = "FABRIC";
  /*
   * Lightning BOLT #8 uses protocol names like Noise_XK_secp256k1_… with prologue "lightning".
   * Native Lightning interop would use XK + secp256k1 — not this Curve25519 XX path.
   */
  static const uint8_t lightning_prologue[] = "lightning";
  if (out_len)
    *out_len = 0;
  if (app == NOISE_PROTOCOL_LIGHTNING)
  {
    if (out_len)
      *out_len = sizeof(lightning_prologue) - 1;
    return lightning_prologue;
  }
  if (out_len)
    *out_len = sizeof(fabric_prologue) - 1;
  return fabric_prologue;
}

int noise_perform_xx_handshake(int sock,
                               int is_initiator,
                               NoiseAppProtocol app,
                               const uint8_t *local_curve25519_private32_or_null,
                               const uint8_t *remote_curve25519_public32_or_null,
                               NoiseCipherState **out_send,
                               NoiseCipherState **out_recv)
{
  static int inited = 0;
  if (!inited)
  {
    if (noise_init() != 0)
    { /* ignore */
    }
    inited = 1;
  }
  if (!out_send || !out_recv)
    return -1;
  *out_send = NULL;
  *out_recv = NULL;

  NoiseProtocolId pid;
  noise_get_protocol_id(app, &pid);
  NoiseHandshakeState *hs = NULL;
  if (noise_handshakestate_new_by_id(&hs, &pid, is_initiator ? NOISE_ROLE_INITIATOR : NOISE_ROLE_RESPONDER) != NOISE_ERROR_NONE)
  {
    fprintf(stderr, "[noise] new_by_id failed\n");
    return -1;
  }

  size_t prologue_len = 0;
  const uint8_t *prologue = noise_get_prologue(app, &prologue_len);
  if (noise_handshakestate_set_prologue(hs, prologue, prologue_len) != NOISE_ERROR_NONE)
  {
    fprintf(stderr, "[noise] set_prologue failed\n");
    noise_handshakestate_free(hs);
    return -1;
  }

  NoiseDHState *dh = noise_handshakestate_get_local_keypair_dh(hs);
  if (!dh)
  {
    noise_handshakestate_free(hs);
    return -1;
  }
  if (local_curve25519_private32_or_null)
  {
    if (noise_dhstate_set_keypair_private(dh, local_curve25519_private32_or_null, 32) != NOISE_ERROR_NONE)
    {
      fprintf(stderr, "[noise] set_keypair_private failed\n");
      noise_handshakestate_free(hs);
      return -1;
    }
  }
  else if (noise_dhstate_generate_keypair(dh) != NOISE_ERROR_NONE)
  {
    fprintf(stderr, "[noise] generate_keypair failed\n");
    noise_handshakestate_free(hs);
    return -1;
  }

  if (remote_curve25519_public32_or_null)
  {
    dh = noise_handshakestate_get_remote_public_key_dh(hs);
    if (!dh || noise_dhstate_set_public_key(dh, remote_curve25519_public32_or_null, 32) != NOISE_ERROR_NONE)
    {
      fprintf(stderr, "[noise] set_public_key failed\n");
      noise_handshakestate_free(hs);
      return -1;
    }
  }

  if (noise_handshakestate_start(hs) != NOISE_ERROR_NONE)
  {
    fprintf(stderr, "[noise] start failed\n");
    noise_handshakestate_free(hs);
    return -1;
  }

  int orig_flags = fcntl(sock, F_GETFL, 0);
  if (orig_flags >= 0)
    (void)fcntl(sock, F_SETFL, orig_flags & ~O_NONBLOCK);

  uint8_t buf[4096];
  int complete = 0;

  while (1)
  {
    int action = noise_handshakestate_get_action(hs);
    if (action == NOISE_ACTION_WRITE_MESSAGE)
    {
      NoiseBuffer mb;
      mb.data = buf;
      mb.size = 0;
      mb.max_size = sizeof(buf);
      if (noise_handshakestate_write_message(hs, &mb, NULL) != NOISE_ERROR_NONE)
      {
        fprintf(stderr, "[noise] write_message failed\n");
        noise_handshakestate_free(hs);
        if (orig_flags >= 0)
          (void)fcntl(sock, F_SETFL, orig_flags);
        return -1;
      }
      if (fabric_noise_write_frame(sock, mb.data, mb.size) != 0)
      {
        fprintf(stderr, "[noise] write frame failed\n");
        noise_handshakestate_free(hs);
        if (orig_flags >= 0)
          (void)fcntl(sock, F_SETFL, orig_flags);
        return -1;
      }
    }

    action = noise_handshakestate_get_action(hs);
    if (action == NOISE_ACTION_READ_MESSAGE)
    {
      size_t need = 0;
      if (fabric_noise_read_frame(sock, buf, sizeof(buf), &need) != 0)
      {
        fprintf(stderr, "[noise] read frame failed\n");
        noise_handshakestate_free(hs);
        if (orig_flags >= 0)
          (void)fcntl(sock, F_SETFL, orig_flags);
        return -1;
      }
      NoiseBuffer mb;
      mb.data = buf;
      mb.size = need;
      mb.max_size = sizeof(buf);
      if (noise_handshakestate_read_message(hs, &mb, NULL) != NOISE_ERROR_NONE)
      {
        fprintf(stderr, "[noise] read_message failed\n");
        noise_handshakestate_free(hs);
        if (orig_flags >= 0)
          (void)fcntl(sock, F_SETFL, orig_flags);
        return -1;
      }
    }

    action = noise_handshakestate_get_action(hs);
    if (action == NOISE_ACTION_SPLIT)
    {
      if (noise_handshakestate_split(hs, out_send, out_recv) != NOISE_ERROR_NONE)
      {
        fprintf(stderr, "[noise] split failed\n");
        noise_handshakestate_free(hs);
        if (orig_flags >= 0)
          (void)fcntl(sock, F_SETFL, orig_flags);
        return -1;
      }
      complete = 1;
      break;
    }
  }

  if (orig_flags >= 0)
    (void)fcntl(sock, F_SETFL, orig_flags);

  noise_handshakestate_free(hs);
  return complete ? 0 : -1;
}
