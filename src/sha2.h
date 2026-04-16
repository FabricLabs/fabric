#ifndef FABRIC_SHA2_H
#define FABRIC_SHA2_H

#include <stddef.h>
#include <stdint.h>

int fabric_sha256(const uint8_t *data, size_t len, uint8_t out32[32]);
int fabric_sha512(const uint8_t *data, size_t len, uint8_t out64[64]);
int fabric_hmac_sha512(const uint8_t *key, size_t key_len,
                       const uint8_t *data, size_t data_len,
                       uint8_t out64[64]);
int fabric_pbkdf2_hmac_sha512(const uint8_t *password, size_t password_len,
                              const uint8_t *salt, size_t salt_len,
                              uint32_t iterations,
                              uint8_t *out, size_t out_len);

#endif
