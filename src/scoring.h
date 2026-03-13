#ifndef SCORING_H
#define SCORING_H

#include <stdint.h>
#include <stdbool.h>
#include <time.h>
#include "errors.h"

// Peer scoring constants
#define PEER_SCORE_MIN -1000
#define PEER_SCORE_MAX 10000
#define PEER_SCORE_DEFAULT 100
#define PEER_SCORE_INITIAL 50

// Score thresholds for different peer categories
#define PEER_SCORE_TRUSTED 500
#define PEER_SCORE_GOOD 200
#define PEER_SCORE_NEUTRAL 0
#define PEER_SCORE_SUSPICIOUS -100
#define PEER_SCORE_BANNED -500

// Behavior scoring weights
#define SCORE_GOOD_BEHAVIOR_WEIGHT 10
#define SCORE_BAD_BEHAVIOR_WEIGHT 20
#define SCORE_TIME_DECAY_WEIGHT 1
#define SCORE_CONNECTION_WEIGHT 5
#define SCORE_MESSAGE_WEIGHT 2
#define SCORE_CRYPTOGRAPHIC_WEIGHT 50

// Time decay constants (in seconds)
#define SCORE_DECAY_INTERVAL 3600 // 1 hour
#define SCORE_DECAY_RATE 0.95     // 5% decay per hour
#define SCORE_MIN_DECAY 0.1       // Minimum decay rate

// Peer behavior types
typedef enum
{
    PEER_BEHAVIOR_CONNECTION_ESTABLISHED = 0,
    PEER_BEHAVIOR_CONNECTION_FAILED,
    PEER_BEHAVIOR_MESSAGE_SENT_SUCCESS,
    PEER_BEHAVIOR_MESSAGE_SENT_FAILED,
    PEER_BEHAVIOR_MESSAGE_RECEIVED_VALID,
    PEER_BEHAVIOR_MESSAGE_RECEIVED_INVALID,
    PEER_BEHAVIOR_HANDSHAKE_SUCCESS,
    PEER_BEHAVIOR_HANDSHAKE_FAILED,
    PEER_BEHAVIOR_SIGNATURE_VERIFIED,
    PEER_BEHAVIOR_SIGNATURE_INVALID,
    PEER_BEHAVIOR_TIMEOUT,
    PEER_BEHAVIOR_PROTOCOL_VIOLATION,
    PEER_BEHAVIOR_SPAM_DETECTED,
    PEER_BEHAVIOR_DOS_ATTEMPT,
    PEER_BEHAVIOR_GOOD_SERVICE,
    PEER_BEHAVIOR_POOR_SERVICE,
    PEER_BEHAVIOR_HELPFUL_ROUTING,
    PEER_BEHAVIOR_SELFISH_ROUTING,
    PEER_BEHAVIOR_COUNT
} PeerBehaviorType;

// Peer behavior record
typedef struct
{
    PeerBehaviorType type;
    time_t timestamp;
    int32_t score_change;
    const char *description;
    void *context; // Additional context data
} PeerBehaviorRecord;

// Peer scoring statistics
typedef struct
{
    int32_t current_score;
    int32_t peak_score;
    int32_t total_score_earned;
    int32_t total_score_lost;
    time_t first_seen;
    time_t last_activity;
    time_t last_score_update;
    uint32_t behavior_count[PEER_BEHAVIOR_COUNT];
    uint32_t connection_attempts;
    uint32_t successful_connections;
    uint32_t failed_connections;
    uint32_t messages_sent;
    uint32_t messages_received;
    uint32_t invalid_messages;
    uint32_t protocol_violations;
    uint32_t timeouts;
    double average_response_time;
    uint32_t response_time_samples;
} PeerScoringStats;

// Peer scoring context
typedef struct
{
    char peer_id[64];                     // Unique peer identifier
    PeerScoringStats stats;               // Scoring statistics
    PeerBehaviorRecord *recent_behaviors; // Recent behavior history
    uint32_t behavior_history_size;
    uint32_t behavior_history_capacity;
    bool is_banned;
    time_t ban_expiry;
    const char *ban_reason;
    void *user_data; // User-defined data
} PeerScoringContext;

// Peer scoring system
typedef struct
{
    PeerScoringContext **peers;
    uint32_t peer_count;
    uint32_t peer_capacity;
    time_t last_cleanup;
    uint32_t max_peers;
    bool auto_cleanup_enabled;
    uint32_t cleanup_interval;
} PeerScoringSystem;

// Function declarations

// Peer scoring system management
FabricError peer_scoring_init(PeerScoringSystem *system, uint32_t max_peers);
void peer_scoring_cleanup(PeerScoringSystem *system);
FabricError peer_scoring_add_peer(PeerScoringSystem *system, const char *peer_id);
FabricError peer_scoring_remove_peer(PeerScoringSystem *system, const char *peer_id);
PeerScoringContext *peer_scoring_get_peer(PeerScoringSystem *system, const char *peer_id);

// Score management
FabricError peer_scoring_record_behavior(PeerScoringSystem *system, const char *peer_id,
                                         PeerBehaviorType behavior, int32_t score_change,
                                         const char *description, void *context);
FabricError peer_scoring_update_score(PeerScoringSystem *system, const char *peer_id,
                                      int32_t score_change, const char *reason);
int32_t peer_scoring_get_score(PeerScoringSystem *system, const char *peer_id);
FabricError peer_scoring_set_score(PeerScoringSystem *system, const char *peer_id, int32_t score);

// Peer selection and ranking
FabricError peer_scoring_get_top_peers(PeerScoringSystem *system, PeerScoringContext **peers,
                                       uint32_t max_peers, uint32_t *actual_count);
FabricError peer_scoring_get_trusted_peers(PeerScoringSystem *system, PeerScoringContext **peers,
                                           uint32_t max_peers, uint32_t *actual_count);
FabricError peer_scoring_get_peers_by_score_range(PeerScoringSystem *system, PeerScoringContext **peers,
                                                  uint32_t max_peers, uint32_t *actual_count,
                                                  int32_t min_score, int32_t max_score);

// Peer behavior analysis
bool peer_scoring_is_trusted(PeerScoringSystem *system, const char *peer_id);
bool peer_scoring_is_banned(PeerScoringSystem *system, const char *peer_id);
FabricError peer_scoring_ban_peer(PeerScoringSystem *system, const char *peer_id,
                                  const char *reason, time_t duration);
FabricError peer_scoring_unban_peer(PeerScoringSystem *system, const char *peer_id);
FabricError peer_scoring_get_behavior_history(PeerScoringSystem *system, const char *peer_id,
                                              PeerBehaviorRecord **records, uint32_t *count);

// Statistics and monitoring
FabricError peer_scoring_get_stats(PeerScoringSystem *system, const char *peer_id,
                                   PeerScoringStats *stats);
FabricError peer_scoring_get_system_stats(PeerScoringSystem *system, uint32_t *total_peers,
                                          uint32_t *trusted_peers, uint32_t *banned_peers);
FabricError peer_scoring_export_stats(PeerScoringSystem *system, const char *filename);
FabricError peer_scoring_import_stats(PeerScoringSystem *system, const char *filename);

// Time-based operations
FabricError peer_scoring_apply_time_decay(PeerScoringSystem *system);
FabricError peer_scoring_cleanup_inactive_peers(PeerScoringSystem *system, time_t max_inactive_time);

// Utility functions
const char *peer_behavior_type_to_string(PeerBehaviorType behavior);
int32_t peer_behavior_get_default_score(PeerBehaviorType behavior);
bool peer_scoring_is_score_valid(int32_t score);
FabricError peer_scoring_normalize_score(int32_t *score);

// Configuration
FabricError peer_scoring_set_auto_cleanup(PeerScoringSystem *system, bool enabled, uint32_t interval);
FabricError peer_scoring_set_max_peers(PeerScoringSystem *system, uint32_t max_peers);

#endif // SCORING_H
