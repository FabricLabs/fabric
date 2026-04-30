#include "sha2.h"
#include "memory.h"

#include <string.h>

typedef struct {
  uint64_t bitlen;
  uint32_t state[8];
  uint8_t data[64];
  size_t datalen;
} fabric_sha256_ctx;

typedef struct {
  uint64_t bitlen[2];
  uint64_t state[8];
  uint8_t data[128];
  size_t datalen;
} fabric_sha512_ctx;

static const uint32_t K256[64] = {
  0x428a2f98U, 0x71374491U, 0xb5c0fbcfU, 0xe9b5dba5U, 0x3956c25bU, 0x59f111f1U, 0x923f82a4U, 0xab1c5ed5U,
  0xd807aa98U, 0x12835b01U, 0x243185beU, 0x550c7dc3U, 0x72be5d74U, 0x80deb1feU, 0x9bdc06a7U, 0xc19bf174U,
  0xe49b69c1U, 0xefbe4786U, 0x0fc19dc6U, 0x240ca1ccU, 0x2de92c6fU, 0x4a7484aaU, 0x5cb0a9dcU, 0x76f988daU,
  0x983e5152U, 0xa831c66dU, 0xb00327c8U, 0xbf597fc7U, 0xc6e00bf3U, 0xd5a79147U, 0x06ca6351U, 0x14292967U,
  0x27b70a85U, 0x2e1b2138U, 0x4d2c6dfcU, 0x53380d13U, 0x650a7354U, 0x766a0abbU, 0x81c2c92eU, 0x92722c85U,
  0xa2bfe8a1U, 0xa81a664bU, 0xc24b8b70U, 0xc76c51a3U, 0xd192e819U, 0xd6990624U, 0xf40e3585U, 0x106aa070U,
  0x19a4c116U, 0x1e376c08U, 0x2748774cU, 0x34b0bcb5U, 0x391c0cb3U, 0x4ed8aa4aU, 0x5b9cca4fU, 0x682e6ff3U,
  0x748f82eeU, 0x78a5636fU, 0x84c87814U, 0x8cc70208U, 0x90befffaU, 0xa4506cebU, 0xbef9a3f7U, 0xc67178f2U
};

static const uint64_t K512[80] = {
  0x428a2f98d728ae22ULL, 0x7137449123ef65cdULL, 0xb5c0fbcfec4d3b2fULL, 0xe9b5dba58189dbbcULL,
  0x3956c25bf348b538ULL, 0x59f111f1b605d019ULL, 0x923f82a4af194f9bULL, 0xab1c5ed5da6d8118ULL,
  0xd807aa98a3030242ULL, 0x12835b0145706fbeULL, 0x243185be4ee4b28cULL, 0x550c7dc3d5ffb4e2ULL,
  0x72be5d74f27b896fULL, 0x80deb1fe3b1696b1ULL, 0x9bdc06a725c71235ULL, 0xc19bf174cf692694ULL,
  0xe49b69c19ef14ad2ULL, 0xefbe4786384f25e3ULL, 0x0fc19dc68b8cd5b5ULL, 0x240ca1cc77ac9c65ULL,
  0x2de92c6f592b0275ULL, 0x4a7484aa6ea6e483ULL, 0x5cb0a9dcbd41fbd4ULL, 0x76f988da831153b5ULL,
  0x983e5152ee66dfabULL, 0xa831c66d2db43210ULL, 0xb00327c898fb213fULL, 0xbf597fc7beef0ee4ULL,
  0xc6e00bf33da88fc2ULL, 0xd5a79147930aa725ULL, 0x06ca6351e003826fULL, 0x142929670a0e6e70ULL,
  0x27b70a8546d22ffcULL, 0x2e1b21385c26c926ULL, 0x4d2c6dfc5ac42aedULL, 0x53380d139d95b3dfULL,
  0x650a73548baf63deULL, 0x766a0abb3c77b2a8ULL, 0x81c2c92e47edaee6ULL, 0x92722c851482353bULL,
  0xa2bfe8a14cf10364ULL, 0xa81a664bbc423001ULL, 0xc24b8b70d0f89791ULL, 0xc76c51a30654be30ULL,
  0xd192e819d6ef5218ULL, 0xd69906245565a910ULL, 0xf40e35855771202aULL, 0x106aa07032bbd1b8ULL,
  0x19a4c116b8d2d0c8ULL, 0x1e376c085141ab53ULL, 0x2748774cdf8eeb99ULL, 0x34b0bcb5e19b48a8ULL,
  0x391c0cb3c5c95a63ULL, 0x4ed8aa4ae3418acbULL, 0x5b9cca4f7763e373ULL, 0x682e6ff3d6b2b8a3ULL,
  0x748f82ee5defb2fcULL, 0x78a5636f43172f60ULL, 0x84c87814a1f0ab72ULL, 0x8cc702081a6439ecULL,
  0x90befffa23631e28ULL, 0xa4506cebde82bde9ULL, 0xbef9a3f7b2c67915ULL, 0xc67178f2e372532bULL,
  0xca273eceea26619cULL, 0xd186b8c721c0c207ULL, 0xeada7dd6cde0eb1eULL, 0xf57d4f7fee6ed178ULL,
  0x06f067aa72176fbaULL, 0x0a637dc5a2c898a6ULL, 0x113f9804bef90daeULL, 0x1b710b35131c471bULL,
  0x28db77f523047d84ULL, 0x32caab7b40c72493ULL, 0x3c9ebe0a15c9bebcULL, 0x431d67c49c100d4cULL,
  0x4cc5d4becb3e42b6ULL, 0x597f299cfc657e2aULL, 0x5fcb6fab3ad6faecULL, 0x6c44198c4a475817ULL
};

#define ROTRIGHT32(a, b) (((a) >> (b)) | ((a) << (32 - (b))))
#define CH32(x, y, z) (((x) & (y)) ^ (~(x) & (z)))
#define MAJ32(x, y, z) (((x) & (y)) ^ ((x) & (z)) ^ ((y) & (z)))
#define EP0_32(x) (ROTRIGHT32((x), 2) ^ ROTRIGHT32((x), 13) ^ ROTRIGHT32((x), 22))
#define EP1_32(x) (ROTRIGHT32((x), 6) ^ ROTRIGHT32((x), 11) ^ ROTRIGHT32((x), 25))
#define SIG0_32(x) (ROTRIGHT32((x), 7) ^ ROTRIGHT32((x), 18) ^ ((x) >> 3))
#define SIG1_32(x) (ROTRIGHT32((x), 17) ^ ROTRIGHT32((x), 19) ^ ((x) >> 10))

#define ROTRIGHT64(a, b) (((a) >> (b)) | ((a) << (64 - (b))))
#define CH64(x, y, z) (((x) & (y)) ^ (~(x) & (z)))
#define MAJ64(x, y, z) (((x) & (y)) ^ ((x) & (z)) ^ ((y) & (z)))
#define EP0_64(x) (ROTRIGHT64((x), 28) ^ ROTRIGHT64((x), 34) ^ ROTRIGHT64((x), 39))
#define EP1_64(x) (ROTRIGHT64((x), 14) ^ ROTRIGHT64((x), 18) ^ ROTRIGHT64((x), 41))
#define SIG0_64(x) (ROTRIGHT64((x), 1) ^ ROTRIGHT64((x), 8) ^ ((x) >> 7))
#define SIG1_64(x) (ROTRIGHT64((x), 19) ^ ROTRIGHT64((x), 61) ^ ((x) >> 6))

static void fabric_sha256_transform(fabric_sha256_ctx *ctx, const uint8_t data[])
{
  uint32_t m[64];
  uint32_t a, b, c, d, e, f, g, h;
  uint32_t t1, t2;
  size_t i, j;

  for (i = 0, j = 0; i < 16; ++i, j += 4) {
    m[i] = ((uint32_t)data[j] << 24) | ((uint32_t)data[j + 1] << 16) | ((uint32_t)data[j + 2] << 8) | ((uint32_t)data[j + 3]);
  }
  for (; i < 64; ++i) {
    m[i] = SIG1_32(m[i - 2]) + m[i - 7] + SIG0_32(m[i - 15]) + m[i - 16];
  }

  a = ctx->state[0]; b = ctx->state[1]; c = ctx->state[2]; d = ctx->state[3];
  e = ctx->state[4]; f = ctx->state[5]; g = ctx->state[6]; h = ctx->state[7];

  for (i = 0; i < 64; ++i) {
    t1 = h + EP1_32(e) + CH32(e, f, g) + K256[i] + m[i];
    t2 = EP0_32(a) + MAJ32(a, b, c);
    h = g; g = f; f = e; e = d + t1;
    d = c; c = b; b = a; a = t1 + t2;
  }

  ctx->state[0] += a; ctx->state[1] += b; ctx->state[2] += c; ctx->state[3] += d;
  ctx->state[4] += e; ctx->state[5] += f; ctx->state[6] += g; ctx->state[7] += h;
}

static void fabric_sha256_init(fabric_sha256_ctx *ctx)
{
  ctx->datalen = 0;
  ctx->bitlen = 0;
  ctx->state[0] = 0x6a09e667U;
  ctx->state[1] = 0xbb67ae85U;
  ctx->state[2] = 0x3c6ef372U;
  ctx->state[3] = 0xa54ff53aU;
  ctx->state[4] = 0x510e527fU;
  ctx->state[5] = 0x9b05688cU;
  ctx->state[6] = 0x1f83d9abU;
  ctx->state[7] = 0x5be0cd19U;
}

static void fabric_sha256_update(fabric_sha256_ctx *ctx, const uint8_t *data, size_t len)
{
  size_t i;
  for (i = 0; i < len; ++i) {
    ctx->data[ctx->datalen++] = data[i];
    if (ctx->datalen == 64) {
      fabric_sha256_transform(ctx, ctx->data);
      ctx->bitlen += 512;
      ctx->datalen = 0;
    }
  }
}

static void fabric_sha256_final(fabric_sha256_ctx *ctx, uint8_t hash[32])
{
  size_t i = ctx->datalen;
  if (ctx->datalen < 56) {
    ctx->data[i++] = 0x80;
    while (i < 56) ctx->data[i++] = 0x00;
  } else {
    ctx->data[i++] = 0x80;
    while (i < 64) ctx->data[i++] = 0x00;
    fabric_sha256_transform(ctx, ctx->data);
    memset(ctx->data, 0, 56);
  }

  ctx->bitlen += ctx->datalen * 8;
  ctx->data[63] = (uint8_t)(ctx->bitlen);
  ctx->data[62] = (uint8_t)(ctx->bitlen >> 8);
  ctx->data[61] = (uint8_t)(ctx->bitlen >> 16);
  ctx->data[60] = (uint8_t)(ctx->bitlen >> 24);
  ctx->data[59] = (uint8_t)(ctx->bitlen >> 32);
  ctx->data[58] = (uint8_t)(ctx->bitlen >> 40);
  ctx->data[57] = (uint8_t)(ctx->bitlen >> 48);
  ctx->data[56] = (uint8_t)(ctx->bitlen >> 56);
  fabric_sha256_transform(ctx, ctx->data);

  for (i = 0; i < 4; ++i) {
    hash[i]      = (uint8_t)((ctx->state[0] >> (24 - i * 8)) & 0xff);
    hash[i + 4]  = (uint8_t)((ctx->state[1] >> (24 - i * 8)) & 0xff);
    hash[i + 8]  = (uint8_t)((ctx->state[2] >> (24 - i * 8)) & 0xff);
    hash[i + 12] = (uint8_t)((ctx->state[3] >> (24 - i * 8)) & 0xff);
    hash[i + 16] = (uint8_t)((ctx->state[4] >> (24 - i * 8)) & 0xff);
    hash[i + 20] = (uint8_t)((ctx->state[5] >> (24 - i * 8)) & 0xff);
    hash[i + 24] = (uint8_t)((ctx->state[6] >> (24 - i * 8)) & 0xff);
    hash[i + 28] = (uint8_t)((ctx->state[7] >> (24 - i * 8)) & 0xff);
  }
}

static void fabric_sha512_transform(fabric_sha512_ctx *ctx, const uint8_t data[])
{
  uint64_t m[80];
  uint64_t a, b, c, d, e, f, g, h;
  uint64_t t1, t2;
  size_t i, j;

  for (i = 0, j = 0; i < 16; ++i, j += 8) {
    m[i] = ((uint64_t)data[j] << 56) | ((uint64_t)data[j + 1] << 48) | ((uint64_t)data[j + 2] << 40) | ((uint64_t)data[j + 3] << 32) |
           ((uint64_t)data[j + 4] << 24) | ((uint64_t)data[j + 5] << 16) | ((uint64_t)data[j + 6] << 8) | ((uint64_t)data[j + 7]);
  }
  for (; i < 80; ++i) {
    m[i] = SIG1_64(m[i - 2]) + m[i - 7] + SIG0_64(m[i - 15]) + m[i - 16];
  }

  a = ctx->state[0]; b = ctx->state[1]; c = ctx->state[2]; d = ctx->state[3];
  e = ctx->state[4]; f = ctx->state[5]; g = ctx->state[6]; h = ctx->state[7];

  for (i = 0; i < 80; ++i) {
    t1 = h + EP1_64(e) + CH64(e, f, g) + K512[i] + m[i];
    t2 = EP0_64(a) + MAJ64(a, b, c);
    h = g; g = f; f = e; e = d + t1;
    d = c; c = b; b = a; a = t1 + t2;
  }

  ctx->state[0] += a; ctx->state[1] += b; ctx->state[2] += c; ctx->state[3] += d;
  ctx->state[4] += e; ctx->state[5] += f; ctx->state[6] += g; ctx->state[7] += h;
}

static void fabric_sha512_init(fabric_sha512_ctx *ctx)
{
  ctx->datalen = 0;
  ctx->bitlen[0] = 0;
  ctx->bitlen[1] = 0;
  ctx->state[0] = 0x6a09e667f3bcc908ULL;
  ctx->state[1] = 0xbb67ae8584caa73bULL;
  ctx->state[2] = 0x3c6ef372fe94f82bULL;
  ctx->state[3] = 0xa54ff53a5f1d36f1ULL;
  ctx->state[4] = 0x510e527fade682d1ULL;
  ctx->state[5] = 0x9b05688c2b3e6c1fULL;
  ctx->state[6] = 0x1f83d9abfb41bd6bULL;
  ctx->state[7] = 0x5be0cd19137e2179ULL;
}

static void fabric_sha512_update(fabric_sha512_ctx *ctx, const uint8_t *data, size_t len)
{
  size_t i;
  for (i = 0; i < len; ++i) {
    ctx->data[ctx->datalen++] = data[i];
    if (ctx->datalen == 128) {
      fabric_sha512_transform(ctx, ctx->data);
      if ((ctx->bitlen[0] += 1024) < 1024) ctx->bitlen[1]++;
      ctx->datalen = 0;
    }
  }
}

static void fabric_sha512_final(fabric_sha512_ctx *ctx, uint8_t hash[64])
{
  size_t i = ctx->datalen;
  if (i < 112) {
    ctx->data[i++] = 0x80;
    while (i < 112) ctx->data[i++] = 0x00;
  } else {
    ctx->data[i++] = 0x80;
    while (i < 128) ctx->data[i++] = 0x00;
    fabric_sha512_transform(ctx, ctx->data);
    memset(ctx->data, 0, 112);
  }

  uint64_t low = ctx->bitlen[0] + (uint64_t)(ctx->datalen * 8);
  uint64_t high = ctx->bitlen[1];
  if (low < ctx->bitlen[0]) high++;

  ctx->data[127] = (uint8_t)(low);
  ctx->data[126] = (uint8_t)(low >> 8);
  ctx->data[125] = (uint8_t)(low >> 16);
  ctx->data[124] = (uint8_t)(low >> 24);
  ctx->data[123] = (uint8_t)(low >> 32);
  ctx->data[122] = (uint8_t)(low >> 40);
  ctx->data[121] = (uint8_t)(low >> 48);
  ctx->data[120] = (uint8_t)(low >> 56);
  ctx->data[119] = (uint8_t)(high);
  ctx->data[118] = (uint8_t)(high >> 8);
  ctx->data[117] = (uint8_t)(high >> 16);
  ctx->data[116] = (uint8_t)(high >> 24);
  ctx->data[115] = (uint8_t)(high >> 32);
  ctx->data[114] = (uint8_t)(high >> 40);
  ctx->data[113] = (uint8_t)(high >> 48);
  ctx->data[112] = (uint8_t)(high >> 56);
  fabric_sha512_transform(ctx, ctx->data);

  for (i = 0; i < 8; ++i) {
    hash[i * 8 + 0] = (uint8_t)((ctx->state[i] >> 56) & 0xff);
    hash[i * 8 + 1] = (uint8_t)((ctx->state[i] >> 48) & 0xff);
    hash[i * 8 + 2] = (uint8_t)((ctx->state[i] >> 40) & 0xff);
    hash[i * 8 + 3] = (uint8_t)((ctx->state[i] >> 32) & 0xff);
    hash[i * 8 + 4] = (uint8_t)((ctx->state[i] >> 24) & 0xff);
    hash[i * 8 + 5] = (uint8_t)((ctx->state[i] >> 16) & 0xff);
    hash[i * 8 + 6] = (uint8_t)((ctx->state[i] >> 8) & 0xff);
    hash[i * 8 + 7] = (uint8_t)(ctx->state[i] & 0xff);
  }
}

int fabric_sha256(const uint8_t *data, size_t len, uint8_t out32[32])
{
  if (!out32) return 0;
  if (!data && len != 0) return 0;
  fabric_sha256_ctx ctx;
  fabric_sha256_init(&ctx);
  fabric_sha256_update(&ctx, data, len);
  fabric_sha256_final(&ctx, out32);
  return 1;
}

int fabric_sha512(const uint8_t *data, size_t len, uint8_t out64[64])
{
  if (!out64) return 0;
  if (!data && len != 0) return 0;
  fabric_sha512_ctx ctx;
  fabric_sha512_init(&ctx);
  fabric_sha512_update(&ctx, data, len);
  fabric_sha512_final(&ctx, out64);
  return 1;
}

int fabric_hmac_sha512(const uint8_t *key, size_t key_len,
                       const uint8_t *data, size_t data_len,
                       uint8_t out64[64])
{
  uint8_t key_block[128];
  uint8_t key_hash[64];
  uint8_t o_key_pad[128];
  uint8_t i_key_pad[128];
  uint8_t inner[64];
  size_t i;

#define FABRIC_HMAC_SHA512_WIPE() do { \
    fabric_secure_zero(key_block, sizeof(key_block)); \
    fabric_secure_zero(key_hash, sizeof(key_hash)); \
    fabric_secure_zero(o_key_pad, sizeof(o_key_pad)); \
    fabric_secure_zero(i_key_pad, sizeof(i_key_pad)); \
    fabric_secure_zero(inner, sizeof(inner)); \
  } while (0)

  if (!out64) return 0;
  if ((key == NULL && key_len > 0) || (data == NULL && data_len > 0)) return 0;

  memset(key_block, 0, sizeof(key_block));
  if (key_len > sizeof(key_block)) {
    if (!fabric_sha512(key, key_len, key_hash)) {
      FABRIC_HMAC_SHA512_WIPE();
      return 0;
    }
    memcpy(key_block, key_hash, sizeof(key_hash));
  } else if (key_len > 0 && key != NULL) {
    memcpy(key_block, key, key_len);
  }

  for (i = 0; i < sizeof(key_block); i++) {
    o_key_pad[i] = key_block[i] ^ 0x5c;
    i_key_pad[i] = key_block[i] ^ 0x36;
  }

  fabric_sha512_ctx ctx;
  fabric_sha512_init(&ctx);
  fabric_sha512_update(&ctx, i_key_pad, sizeof(i_key_pad));
  fabric_sha512_update(&ctx, data, data_len);
  fabric_sha512_final(&ctx, inner);

  fabric_sha512_init(&ctx);
  fabric_sha512_update(&ctx, o_key_pad, sizeof(o_key_pad));
  fabric_sha512_update(&ctx, inner, sizeof(inner));
  fabric_sha512_final(&ctx, out64);
  FABRIC_HMAC_SHA512_WIPE();
  return 1;
}

int fabric_pbkdf2_hmac_sha512(const uint8_t *password, size_t password_len,
                              const uint8_t *salt, size_t salt_len,
                              uint32_t iterations,
                              uint8_t *out, size_t out_len)
{
  uint32_t block_index = 1;
  size_t generated = 0;
  uint8_t u[64];
  uint8_t t[64];
  uint8_t sbuf[256];

#define FABRIC_PBKDF2_WIPE() do { \
    fabric_secure_zero(u, sizeof(u)); \
    fabric_secure_zero(t, sizeof(t)); \
    fabric_secure_zero(sbuf, sizeof(sbuf)); \
  } while (0)

  if (!out || iterations == 0) return 0;
  if ((password == NULL && password_len > 0) || (salt == NULL && salt_len > 0)) return 0;
  if (salt_len + 4 > sizeof(sbuf)) return 0;

  while (generated < out_len) {
    memcpy(sbuf, salt, salt_len);
    sbuf[salt_len + 0] = (uint8_t)((block_index >> 24) & 0xff);
    sbuf[salt_len + 1] = (uint8_t)((block_index >> 16) & 0xff);
    sbuf[salt_len + 2] = (uint8_t)((block_index >> 8) & 0xff);
    sbuf[salt_len + 3] = (uint8_t)(block_index & 0xff);

    if (!fabric_hmac_sha512(password, password_len, sbuf, salt_len + 4, u)) {
      FABRIC_PBKDF2_WIPE();
      return 0;
    }
    memcpy(t, u, sizeof(t));

    for (uint32_t i = 1; i < iterations; i++) {
      if (!fabric_hmac_sha512(password, password_len, u, sizeof(u), u)) {
        FABRIC_PBKDF2_WIPE();
        return 0;
      }
      for (size_t j = 0; j < sizeof(t); j++) t[j] ^= u[j];
    }

    size_t to_copy = (out_len - generated > sizeof(t)) ? sizeof(t) : (out_len - generated);
    memcpy(out + generated, t, to_copy);
    generated += to_copy;
    block_index++;
  }

  FABRIC_PBKDF2_WIPE();
  return 1;
}
