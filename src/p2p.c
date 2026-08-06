/**
 * Native addon — P2P stack: threading primitives, scoring, Noise peer (single translation unit).
 * Named p2p.c (not peer.c) so this TU can #include peer.c without self-inclusion.
 */
#include "threads.c"
#include "scoring.c"
#include "peer.c"
