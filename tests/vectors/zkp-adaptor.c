/*
 * Generates tests/vectors/zkp-adaptor.json from BlockstreamResearch/secp256k1-zkp
 * (MuSig2 adaptor signatures and the ecdsa_adaptor module's DLEQ proof).
 *
 *   git clone https://github.com/BlockstreamResearch/secp256k1-zkp /tmp/secp256k1-zkp
 *   cc -O1 -I/tmp/secp256k1-zkp -DENABLE_MODULE_EXTRAKEYS -DENABLE_MODULE_SCHNORRSIG \
 *     -DENABLE_MODULE_MUSIG -DENABLE_MODULE_ECDSA_ADAPTOR tests/vectors/zkp-adaptor.c \
 *     /tmp/secp256k1-zkp/src/precomputed_ecmult.c /tmp/secp256k1-zkp/src/precomputed_ecmult_gen.c \
 *     -o /tmp/zkp-adaptor && /tmp/zkp-adaptor <zkp commit> > tests/vectors/zkp-adaptor.json
 */
#include <stdio.h>
#include <string.h>
#include <stdlib.h>

#include "src/secp256k1.c"

static void fill (unsigned char *out, int a, int b, int c) {
    int j;
    for (j = 0; j < 32; j++) out[j] = (unsigned char) ((a * 73 + b * 31 + c * 17 + j * 13 + 1) & 0xff);
    out[0] &= 0x7f;
}

static void hex (const char *key, const unsigned char *p, size_t n, int comma) {
    size_t i;
    printf("\"%s\": \"", key);
    for (i = 0; i < n; i++) printf("%02x", p[i]);
    printf("\"%s", comma ? ", " : "");
}

static void hex_list (const char *key, const unsigned char *p, size_t stride, size_t len, int n, int comma) {
    int i;
    size_t j;
    printf("\"%s\": [", key);
    for (i = 0; i < n; i++) {
        printf("%s\"", i ? ", " : "");
        for (j = 0; j < len; j++) printf("%02x", p[i * stride + j]);
        printf("\"");
    }
    printf("]%s", comma ? ", " : "");
}

#define CHECK_OK(x) do { if (!(x)) { fprintf(stderr, "failed: %s (line %d)\n", #x, __LINE__); exit(1); } } while (0)

static void musig_vector (const secp256k1_context *ctx, int v, int n, int tweak, int first) {
    unsigned char sk[3][32], rand[3][32], tmp[32], msg[32], tw[32], t[32], t2[32];
    unsigned char pk33[3][66], pubnonce66[3][66], psig32[3][66], aggnonce66[66], T33[33], aggpk32[32];
    unsigned char presig[64], sig[64];
    size_t len;
    int i, parity;
    secp256k1_keypair kp[3];
    secp256k1_pubkey pk[3], T, outpk;
    const secp256k1_pubkey *pkp[3];
    secp256k1_musig_keyagg_cache cache;
    secp256k1_xonly_pubkey aggpk;
    secp256k1_musig_secnonce secnonce[3];
    secp256k1_musig_pubnonce pubnonce[3];
    const secp256k1_musig_pubnonce *pnp[3];
    secp256k1_musig_aggnonce aggnonce;
    secp256k1_musig_session session;
    secp256k1_musig_partial_sig psig[3];
    const secp256k1_musig_partial_sig *psp[3];

    fill(msg, v, 9, 1);
    fill(tw, v, 9, 2);
    fill(t, v, 9, 3);
    for (i = 0; i < n; i++) {
        fill(sk[i], v, i, 4);
        fill(rand[i], v, i, 5);
        CHECK_OK(secp256k1_keypair_create(ctx, &kp[i], sk[i]));
        CHECK_OK(secp256k1_keypair_pub(ctx, &pk[i], &kp[i]));
        len = 33;
        CHECK_OK(secp256k1_ec_pubkey_serialize(ctx, pk33[i], &len, &pk[i], SECP256K1_EC_COMPRESSED));
        pkp[i] = &pk[i];
    }
    CHECK_OK(secp256k1_musig_pubkey_agg(ctx, &aggpk, &cache, pkp, n));
    if (tweak) {
        CHECK_OK(secp256k1_musig_pubkey_xonly_tweak_add(ctx, &outpk, &cache, tw));
        CHECK_OK(secp256k1_xonly_pubkey_from_pubkey(ctx, &aggpk, NULL, &outpk));
    }
    CHECK_OK(secp256k1_xonly_pubkey_serialize(ctx, aggpk32, &aggpk));
    for (i = 0; i < n; i++) {
        memcpy(tmp, rand[i], 32);
        CHECK_OK(secp256k1_musig_nonce_gen(ctx, &secnonce[i], &pubnonce[i], tmp, sk[i], &pk[i], msg, &cache, NULL));
        CHECK_OK(secp256k1_musig_pubnonce_serialize(ctx, pubnonce66[i], &pubnonce[i]));
        pnp[i] = &pubnonce[i];
    }
    CHECK_OK(secp256k1_musig_nonce_agg(ctx, &aggnonce, pnp, n));
    CHECK_OK(secp256k1_musig_aggnonce_serialize(ctx, aggnonce66, &aggnonce));
    CHECK_OK(secp256k1_ec_pubkey_create(ctx, &T, t));
    len = 33;
    CHECK_OK(secp256k1_ec_pubkey_serialize(ctx, T33, &len, &T, SECP256K1_EC_COMPRESSED));
    CHECK_OK(secp256k1_musig_nonce_process(ctx, &session, &aggnonce, msg, &cache, &T));
    for (i = 0; i < n; i++) {
        CHECK_OK(secp256k1_musig_partial_sign(ctx, &psig[i], &secnonce[i], &kp[i], &cache, &session));
        CHECK_OK(secp256k1_musig_partial_sig_verify(ctx, &psig[i], &pubnonce[i], &pk[i], &cache, &session));
        CHECK_OK(secp256k1_musig_partial_sig_serialize(ctx, psig32[i], &psig[i]));
        psp[i] = &psig[i];
    }
    CHECK_OK(secp256k1_musig_partial_sig_agg(ctx, presig, &session, psp, n));
    CHECK_OK(secp256k1_musig_nonce_parity(ctx, &parity, &session));
    CHECK_OK(secp256k1_musig_adapt(ctx, sig, presig, t, parity));
    CHECK_OK(secp256k1_schnorrsig_verify(ctx, sig, msg, 32, &aggpk));
    CHECK_OK(!secp256k1_schnorrsig_verify(ctx, presig, msg, 32, &aggpk));
    CHECK_OK(secp256k1_musig_extract_adaptor(ctx, t2, sig, presig, parity));
    CHECK_OK(memcmp(t, t2, 32) == 0);

    printf("%s    { ", first ? "" : ",\n");
    hex_list("seckeys", sk[0], 32, 32, n, 1);
    hex_list("pubkeys", pk33[0], 66, 33, n, 1);
    hex_list("rands", rand[0], 32, 32, n, 1);
    hex("msg", msg, 32, 1);
    hex("tweak", tw, 32, 1);
    printf("\"tweaked\": %s, ", tweak ? "true" : "false");
    hex("aggpk", aggpk32, 32, 1);
    hex("adaptor_secret", t, 32, 1);
    hex("adaptor", T33, 33, 1);
    hex_list("pubnonces", pubnonce66[0], 66, 66, n, 1);
    hex("aggnonce", aggnonce66, 66, 1);
    hex_list("psigs", psig32[0], 66, 32, n, 1);
    hex("pre_sig", presig, 64, 1);
    printf("\"nonce_parity\": %d, ", parity);
    hex("sig", sig, 64, 0);
    printf(" }");
}

static void dleq_vector (const secp256k1_context *ctx, int v, int with_aux, int first) {
    unsigned char x32[32], h32[32], aux[32], gen2_33[33], p1_33[33], p2_33[33], e32[32], s32[32];
    secp256k1_scalar x, s, e;
    secp256k1_ge gen2, p[2];
    secp256k1_pubkey H;
    int overflow;

    fill(x32, v, 7, 6);
    fill(h32, v, 7, 7);
    fill(aux, v, 7, 8);
    secp256k1_scalar_set_b32(&x, x32, &overflow);
    CHECK_OK(!overflow);
    CHECK_OK(secp256k1_ec_pubkey_create(ctx, &H, h32));
    CHECK_OK(secp256k1_pubkey_load(ctx, &gen2, &H));
    secp256k1_dleq_pair(&ctx->ecmult_gen_ctx, p, &x, &gen2);
    CHECK_OK(secp256k1_dleq_prove(ctx, &s, &e, &x, &p[0], &gen2, &p[1], NULL, with_aux ? aux : NULL));
    CHECK_OK(secp256k1_dleq_verify(&ctx->hash_ctx, &s, &e, &p[0], &gen2, &p[1]));
    secp256k1_ge_serialize33(&gen2, gen2_33);
    secp256k1_ge_serialize33(&p[0], p1_33);
    secp256k1_ge_serialize33(&p[1], p2_33);
    secp256k1_scalar_get_b32(e32, &e);
    secp256k1_scalar_get_b32(s32, &s);

    printf("%s    { ", first ? "" : ",\n");
    hex("secret", x32, 32, 1);
    hex("generator", gen2_33, 33, 1);
    hex("p1", p1_33, 33, 1);
    hex("p2", p2_33, 33, 1);
    if (with_aux) hex("aux", aux, 32, 1);
    hex("e", e32, 32, 1);
    hex("s", s32, 32, 0);
    printf(" }");
}

int main (int argc, char **argv) {
    secp256k1_context *ctx = secp256k1_context_create(SECP256K1_CONTEXT_NONE);
    int v, first = 1;

    printf("{\n  \"source\": \"BlockstreamResearch/secp256k1-zkp %s\",\n", argc > 1 ? argv[1] : "unknown");
    printf("  \"musig_adaptor\": [\n");
    for (v = 0; v < 8; v++) {
        musig_vector(ctx, v, (v % 4 == 3) ? 3 : 2, v % 2, first);
        first = 0;
    }
    printf("\n  ],\n  \"dleq\": [\n");
    first = 1;
    for (v = 0; v < 4; v++) {
        dleq_vector(ctx, v, v % 2, first);
        first = 0;
    }
    printf("\n  ]\n}\n");
    secp256k1_context_destroy(ctx);
    return 0;
}
