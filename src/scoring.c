#include "scoring.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <assert.h>
#include <math.h>

// Default behavior scores
static const int32_t DEFAULT_BEHAVIOR_SCORES[PEER_BEHAVIOR_COUNT] = {
    [PEER_BEHAVIOR_CONNECTION_ESTABLISHED] = 10,
    [PEER_BEHAVIOR_CONNECTION_FAILED] = -5,
    [PEER_BEHAVIOR_MESSAGE_SENT_SUCCESS] = 2,
    [PEER_BEHAVIOR_MESSAGE_SENT_FAILED] = -3,
    [PEER_BEHAVIOR_MESSAGE_RECEIVED_VALID] = 1,
    [PEER_BEHAVIOR_MESSAGE_RECEIVED_INVALID] = -10,
    [PEER_BEHAVIOR_HANDSHAKE_SUCCESS] = 15,
    [PEER_BEHAVIOR_HANDSHAKE_FAILED] = -15,
    [PEER_BEHAVIOR_SIGNATURE_VERIFIED] = 5,
    [PEER_BEHAVIOR_SIGNATURE_INVALID] = -25,
    [PEER_BEHAVIOR_TIMEOUT] = -8,
    [PEER_BEHAVIOR_PROTOCOL_VIOLATION] = -30,
    [PEER_BEHAVIOR_SPAM_DETECTED] = -50,
    [PEER_BEHAVIOR_DOS_ATTEMPT] = -100,
    [PEER_BEHAVIOR_GOOD_SERVICE] = 8,
    [PEER_BEHAVIOR_POOR_SERVICE] = -8,
    [PEER_BEHAVIOR_HELPFUL_ROUTING] = 12,
    [PEER_BEHAVIOR_SELFISH_ROUTING] = -20};

// Behavior type names
static const char *BEHAVIOR_TYPE_NAMES[PEER_BEHAVIOR_COUNT] = {
    "Connection Established",
    "Connection Failed",
    "Message Sent Success",
    "Message Sent Failed",
    "Message Received Valid",
    "Message Received Invalid",
    "Handshake Success",
    "Handshake Failed",
    "Signature Verified",
    "Signature Invalid",
    "Timeout",
    "Protocol Violation",
    "Spam Detected",
    "DoS Attempt",
    "Good Service",
    "Poor Service",
    "Helpful Routing",
    "Selfish Routing"};

// Initialize peer scoring system
FabricError peer_scoring_init(PeerScoringSystem *system, uint32_t max_peers)
{
  FABRIC_CHECK_NULL(system);

  if (max_peers == 0)
  {
    return FABRIC_ERROR_INVALID_ARGUMENT;
  }

  system->peers = calloc(max_peers, sizeof(PeerScoringContext *));
  if (!system->peers)
  {
    return FABRIC_ERROR_OUT_OF_MEMORY;
  }

  system->peer_count = 0;
  system->peer_capacity = max_peers;
  system->max_peers = max_peers;
  system->last_cleanup = time(NULL);
  system->auto_cleanup_enabled = true;
  system->cleanup_interval = 3600; // 1 hour

  return FABRIC_SUCCESS;
}

// Cleanup peer scoring system
void peer_scoring_cleanup(PeerScoringSystem *system)
{
  if (!system)
  {
    return;
  }

  // Free all peer contexts
  for (uint32_t i = 0; i < system->peer_count; i++)
  {
    if (system->peers[i])
    {
      if (system->peers[i]->recent_behaviors)
      {
        free(system->peers[i]->recent_behaviors);
      }
      free(system->peers[i]);
    }
  }

  free(system->peers);
  system->peers = NULL;
  system->peer_count = 0;
  system->peer_capacity = 0;
}

// Create a new peer context
static PeerScoringContext *create_peer_context(const char *peer_id)
{
  PeerScoringContext *context = calloc(1, sizeof(PeerScoringContext));
  if (!context)
  {
    return NULL;
  }

  strncpy(context->peer_id, peer_id, sizeof(context->peer_id) - 1);
  context->peer_id[sizeof(context->peer_id) - 1] = '\0';

  // Initialize statistics
  context->stats.current_score = PEER_SCORE_INITIAL;
  context->stats.peak_score = PEER_SCORE_INITIAL;
  context->stats.total_score_earned = PEER_SCORE_INITIAL;
  context->stats.total_score_lost = 0;
  context->stats.first_seen = time(NULL);
  context->stats.last_activity = time(NULL);
  context->stats.last_score_update = time(NULL);

  // Initialize behavior history
  context->behavior_history_capacity = 100;
  context->behavior_history_size = 0;
  context->recent_behaviors = calloc(context->behavior_history_capacity, sizeof(PeerBehaviorRecord));
  if (!context->recent_behaviors)
  {
    free(context);
    return NULL;
  }

  // Initialize behavior counts
  memset(context->stats.behavior_count, 0, sizeof(context->stats.behavior_count));

  context->is_banned = false;
  context->ban_expiry = 0;
  context->ban_reason = NULL;
  context->user_data = NULL;

  return context;
}

// Add a new peer to the scoring system
FabricError peer_scoring_add_peer(PeerScoringSystem *system, const char *peer_id)
{
  FABRIC_CHECK_NULL(system);
  FABRIC_CHECK_NULL(peer_id);

  // Check if peer already exists
  if (peer_scoring_get_peer(system, peer_id))
  {
    return FABRIC_ERROR_ALREADY_EXISTS;
  }

  // Check capacity
  if (system->peer_count >= system->peer_capacity)
  {
    return FABRIC_ERROR_OUT_OF_MEMORY;
  }

  // Create new peer context
  PeerScoringContext *context = create_peer_context(peer_id);
  if (!context)
  {
    return FABRIC_ERROR_OUT_OF_MEMORY;
  }

  // Add to system
  system->peers[system->peer_count] = context;
  system->peer_count++;

  return FABRIC_SUCCESS;
}

// Remove a peer from the scoring system
FabricError peer_scoring_remove_peer(PeerScoringSystem *system, const char *peer_id)
{
  FABRIC_CHECK_NULL(system);
  FABRIC_CHECK_NULL(peer_id);

  for (uint32_t i = 0; i < system->peer_count; i++)
  {
    if (system->peers[i] && strcmp(system->peers[i]->peer_id, peer_id) == 0)
    {
      // Free peer context
      if (system->peers[i]->recent_behaviors)
      {
        free(system->peers[i]->recent_behaviors);
      }
      free(system->peers[i]);

      // Shift remaining peers
      for (uint32_t j = i; j < system->peer_count - 1; j++)
      {
        system->peers[j] = system->peers[j + 1];
      }
      system->peer_count--;
      system->peers[system->peer_count] = NULL;

      return FABRIC_SUCCESS;
    }
  }

  return FABRIC_ERROR_NOT_FOUND;
}

// Get peer context by ID
PeerScoringContext *peer_scoring_get_peer(PeerScoringSystem *system, const char *peer_id)
{
  if (!system || !peer_id)
  {
    return NULL;
  }

  for (uint32_t i = 0; i < system->peer_count; i++)
  {
    if (system->peers[i] && strcmp(system->peers[i]->peer_id, peer_id) == 0)
    {
      return system->peers[i];
    }
  }

  return NULL;
}

// Add behavior record to peer history
static FabricError add_behavior_record(PeerScoringContext *context, PeerBehaviorType behavior,
                                       int32_t score_change, const char *description, void *ctx)
{
  if (!context)
  {
    return FABRIC_ERROR_NULL_POINTER;
  }

  // Expand history if needed
  if (context->behavior_history_size >= context->behavior_history_capacity)
  {
    uint32_t new_capacity = context->behavior_history_capacity * 2;
    PeerBehaviorRecord *new_history = realloc(context->recent_behaviors,
                                              new_capacity * sizeof(PeerBehaviorRecord));
    if (!new_history)
    {
      return FABRIC_ERROR_OUT_OF_MEMORY;
    }

    context->recent_behaviors = new_history;
    context->behavior_history_capacity = new_capacity;
  }

  // Add new record
  PeerBehaviorRecord *record = &context->recent_behaviors[context->behavior_history_size];
  record->type = behavior;
  record->timestamp = time(NULL);
  record->score_change = score_change;
  record->description = description;
  record->context = ctx;

  context->behavior_history_size++;

  // Update behavior count
  context->stats.behavior_count[behavior]++;

  return FABRIC_SUCCESS;
}

// Record peer behavior
FabricError peer_scoring_record_behavior(PeerScoringSystem *system, const char *peer_id,
                                         PeerBehaviorType behavior, int32_t score_change,
                                         const char *description, void *context)
{
  FABRIC_CHECK_NULL(system);
  FABRIC_CHECK_NULL(peer_id);

  PeerScoringContext *peer = peer_scoring_get_peer(system, peer_id);
  if (!peer)
  {
    // Auto-create peer if it doesn't exist
    FabricError result = peer_scoring_add_peer(system, peer_id);
    if (result != FABRIC_SUCCESS)
    {
      return result;
    }
    peer = peer_scoring_get_peer(system, peer_id);
  }

  // Add behavior record
  FabricError result = add_behavior_record(peer, behavior, score_change, description, context);
  if (result != FABRIC_SUCCESS)
  {
    return result;
  }

  // Update score
  return peer_scoring_update_score(system, peer_id, score_change, description);
}

// Update peer score
FabricError peer_scoring_update_score(PeerScoringSystem *system, const char *peer_id,
                                      int32_t score_change, const char *reason)
{
  FABRIC_CHECK_NULL(system);
  FABRIC_CHECK_NULL(peer_id);

  PeerScoringContext *peer = peer_scoring_get_peer(system, peer_id);
  if (!peer)
  {
    return FABRIC_ERROR_NOT_FOUND;
  }

  // Update score
  peer->stats.current_score += score_change;

  // Normalize score to valid range
  peer_scoring_normalize_score(&peer->stats.current_score);

  // Update statistics
  if (score_change > 0)
  {
    peer->stats.total_score_earned += score_change;
  }
  else
  {
    peer->stats.total_score_lost += -score_change;
  }

  if (peer->stats.current_score > peer->stats.peak_score)
  {
    peer->stats.peak_score = peer->stats.current_score;
  }

  peer->stats.last_score_update = time(NULL);
  peer->stats.last_activity = time(NULL);

  // Check if peer should be banned
  if (peer->stats.current_score <= PEER_SCORE_BANNED && !peer->is_banned)
  {
    const char *ban_reason = reason ? reason : "Score too low";
    peer_scoring_ban_peer(system, peer_id, ban_reason, 86400); // 24 hours
  }

  return FABRIC_SUCCESS;
}

// Get peer score
int32_t peer_scoring_get_score(PeerScoringSystem *system, const char *peer_id)
{
  if (!system || !peer_id)
  {
    return PEER_SCORE_MIN;
  }

  PeerScoringContext *peer = peer_scoring_get_peer(system, peer_id);
  if (!peer)
  {
    return PEER_SCORE_MIN;
  }

  return peer->stats.current_score;
}

// Set peer score
FabricError peer_scoring_set_score(PeerScoringSystem *system, const char *peer_id, int32_t score)
{
  FABRIC_CHECK_NULL(system);
  FABRIC_CHECK_NULL(peer_id);

  PeerScoringContext *peer = peer_scoring_get_peer(system, peer_id);
  if (!peer)
  {
    return FABRIC_ERROR_NOT_FOUND;
  }

  // Normalize score to valid range
  int32_t normalized_score = score;
  peer_scoring_normalize_score(&normalized_score);
  peer->stats.current_score = normalized_score;

  // Update peak score if necessary
  if (normalized_score > peer->stats.peak_score)
  {
    peer->stats.peak_score = normalized_score;
  }

  peer->stats.last_score_update = time(NULL);

  // Check if peer should be banned due to low score
  if (peer->stats.current_score <= PEER_SCORE_BANNED && !peer->is_banned)
  {
    peer_scoring_ban_peer(system, peer_id, "Score too low", 86400); // 24 hours
  }

  return FABRIC_SUCCESS;
}

// Get top peers by score
FabricError peer_scoring_get_top_peers(PeerScoringSystem *system, PeerScoringContext **peers,
                                       uint32_t max_peers, uint32_t *actual_count)
{
  FABRIC_CHECK_NULL(system);
  FABRIC_CHECK_NULL(peers);
  FABRIC_CHECK_NULL(actual_count);

  if (max_peers == 0)
  {
    *actual_count = 0;
    return FABRIC_SUCCESS;
  }

  // Create temporary array for sorting
  PeerScoringContext **temp_peers = malloc(system->peer_count * sizeof(PeerScoringContext *));
  if (!temp_peers)
  {
    return FABRIC_ERROR_OUT_OF_MEMORY;
  }

  // Copy peer pointers
  uint32_t valid_peers = 0;
  for (uint32_t i = 0; i < system->peer_count; i++)
  {
    if (system->peers[i] && !system->peers[i]->is_banned)
    {
      temp_peers[valid_peers++] = system->peers[i];
    }
  }

  // Sort by score (descending)
  for (uint32_t i = 0; i < valid_peers - 1; i++)
  {
    for (uint32_t j = i + 1; j < valid_peers; j++)
    {
      if (temp_peers[i]->stats.current_score < temp_peers[j]->stats.current_score)
      {
        PeerScoringContext *temp = temp_peers[i];
        temp_peers[i] = temp_peers[j];
        temp_peers[j] = temp;
      }
    }
  }

  // Copy top peers
  uint32_t count = (valid_peers < max_peers) ? valid_peers : max_peers;
  for (uint32_t i = 0; i < count; i++)
  {
    peers[i] = temp_peers[i];
  }

  *actual_count = count;
  free(temp_peers);

  return FABRIC_SUCCESS;
}

// Get trusted peers
FabricError peer_scoring_get_trusted_peers(PeerScoringSystem *system, PeerScoringContext **peers,
                                           uint32_t max_peers, uint32_t *actual_count)
{
  return peer_scoring_get_peers_by_score_range(system, peers, max_peers, actual_count,
                                               PEER_SCORE_TRUSTED, PEER_SCORE_MAX);
}

// Get peers by score range
FabricError peer_scoring_get_peers_by_score_range(PeerScoringSystem *system, PeerScoringContext **peers,
                                                  uint32_t max_peers, uint32_t *actual_count,
                                                  int32_t min_score, int32_t max_score)
{
  FABRIC_CHECK_NULL(system);
  FABRIC_CHECK_NULL(peers);
  FABRIC_CHECK_NULL(actual_count);

  if (max_peers == 0)
  {
    *actual_count = 0;
    return FABRIC_SUCCESS;
  }

  uint32_t count = 0;
  for (uint32_t i = 0; i < system->peer_count && count < max_peers; i++)
  {
    if (system->peers[i] && !system->peers[i]->is_banned)
    {
      int32_t score = system->peers[i]->stats.current_score;
      if (score >= min_score && score <= max_score)
      {
        peers[count++] = system->peers[i];
      }
    }
  }

  *actual_count = count;
  return FABRIC_SUCCESS;
}

// Check if peer is trusted
bool peer_scoring_is_trusted(PeerScoringSystem *system, const char *peer_id)
{
  if (!system || !peer_id)
  {
    return false;
  }

  PeerScoringContext *peer = peer_scoring_get_peer(system, peer_id);
  if (!peer)
  {
    return false;
  }

  return peer->stats.current_score >= PEER_SCORE_TRUSTED && !peer->is_banned;
}

// Check if peer is banned
bool peer_scoring_is_banned(PeerScoringSystem *system, const char *peer_id)
{
  if (!system || !peer_id)
  {
    return false;
  }

  PeerScoringContext *peer = peer_scoring_get_peer(system, peer_id);
  if (!peer)
  {
    return false;
  }

  // Check if ban has expired
  if (peer->is_banned && peer->ban_expiry > 0 && time(NULL) > peer->ban_expiry)
  {
    peer->is_banned = false;
    peer->ban_expiry = 0;
    peer->ban_reason = NULL;
    return false;
  }

  return peer->is_banned;
}

// Ban a peer
FabricError peer_scoring_ban_peer(PeerScoringSystem *system, const char *peer_id,
                                  const char *reason, time_t duration)
{
  FABRIC_CHECK_NULL(system);
  FABRIC_CHECK_NULL(peer_id);

  PeerScoringContext *peer = peer_scoring_get_peer(system, peer_id);
  if (!peer)
  {
    return FABRIC_ERROR_NOT_FOUND;
  }

  peer->is_banned = true;
  peer->ban_expiry = time(NULL) + duration;
  peer->ban_reason = reason;

  return FABRIC_SUCCESS;
}

// Unban a peer
FabricError peer_scoring_unban_peer(PeerScoringSystem *system, const char *peer_id)
{
  FABRIC_CHECK_NULL(system);
  FABRIC_CHECK_NULL(peer_id);

  PeerScoringContext *peer = peer_scoring_get_peer(system, peer_id);
  if (!peer)
  {
    return FABRIC_ERROR_NOT_FOUND;
  }

  peer->is_banned = false;
  peer->ban_expiry = 0;
  peer->ban_reason = NULL;

  return FABRIC_SUCCESS;
}

// Get behavior history
FabricError peer_scoring_get_behavior_history(PeerScoringSystem *system, const char *peer_id,
                                              PeerBehaviorRecord **records, uint32_t *count)
{
  FABRIC_CHECK_NULL(system);
  FABRIC_CHECK_NULL(peer_id);
  FABRIC_CHECK_NULL(records);
  FABRIC_CHECK_NULL(count);

  PeerScoringContext *peer = peer_scoring_get_peer(system, peer_id);
  if (!peer)
  {
    return FABRIC_ERROR_NOT_FOUND;
  }

  *records = peer->recent_behaviors;
  *count = peer->behavior_history_size;

  return FABRIC_SUCCESS;
}

// Get peer statistics
FabricError peer_scoring_get_stats(PeerScoringSystem *system, const char *peer_id,
                                   PeerScoringStats *stats)
{
  FABRIC_CHECK_NULL(system);
  FABRIC_CHECK_NULL(peer_id);
  FABRIC_CHECK_NULL(stats);

  PeerScoringContext *peer = peer_scoring_get_peer(system, peer_id);
  if (!peer)
  {
    return FABRIC_ERROR_NOT_FOUND;
  }

  *stats = peer->stats;
  return FABRIC_SUCCESS;
}

// Get system statistics
FabricError peer_scoring_get_system_stats(PeerScoringSystem *system, uint32_t *total_peers,
                                          uint32_t *trusted_peers, uint32_t *banned_peers)
{
  FABRIC_CHECK_NULL(system);
  FABRIC_CHECK_NULL(total_peers);
  FABRIC_CHECK_NULL(trusted_peers);
  FABRIC_CHECK_NULL(banned_peers);

  *total_peers = system->peer_count;
  *trusted_peers = 0;
  *banned_peers = 0;

  for (uint32_t i = 0; i < system->peer_count; i++)
  {
    if (system->peers[i])
    {
      if (system->peers[i]->stats.current_score >= PEER_SCORE_TRUSTED)
      {
        (*trusted_peers)++;
      }
      if (system->peers[i]->is_banned)
      {
        (*banned_peers)++;
      }
    }
  }

  return FABRIC_SUCCESS;
}

// Apply time decay to scores
FabricError peer_scoring_apply_time_decay(PeerScoringSystem *system)
{
  FABRIC_CHECK_NULL(system);

  time_t now = time(NULL);

  for (uint32_t i = 0; i < system->peer_count; i++)
  {
    if (system->peers[i])
    {
      PeerScoringContext *peer = system->peers[i];

      // Apply decay if enough time has passed
      if (now - peer->stats.last_score_update >= SCORE_DECAY_INTERVAL)
      {
        // Calculate decay factor
        double decay_factor = pow(SCORE_DECAY_RATE,
                                  (double)(now - peer->stats.last_score_update) / SCORE_DECAY_INTERVAL);

        // Apply decay to score
        peer->stats.current_score = (int32_t)(peer->stats.current_score * decay_factor);

        // Ensure minimum score
        if (peer->stats.current_score < PEER_SCORE_MIN)
        {
          peer->stats.current_score = PEER_SCORE_MIN;
        }

        peer->stats.last_score_update = now;
      }
    }
  }

  return FABRIC_SUCCESS;
}

// Cleanup inactive peers
FabricError peer_scoring_cleanup_inactive_peers(PeerScoringSystem *system, time_t max_inactive_time)
{
  FABRIC_CHECK_NULL(system);

  time_t now = time(NULL);
  uint32_t removed_count = 0;

  for (int32_t i = system->peer_count - 1; i >= 0; i--)
  {
    if (system->peers[i])
    {
      PeerScoringContext *peer = system->peers[i];

      // Check if peer has been inactive for too long
      if (now - peer->stats.last_activity > max_inactive_time)
      {
        // Remove peer
        if (peer->recent_behaviors)
        {
          free(peer->recent_behaviors);
        }
        free(peer);

        // Shift remaining peers
        for (uint32_t j = i; j < system->peer_count - 1; j++)
        {
          system->peers[j] = system->peers[j + 1];
        }
        system->peer_count--;
        system->peers[system->peer_count] = NULL;

        removed_count++;
      }
    }
  }

  if (removed_count > 0)
  {
    system->last_cleanup = now;
  }

  return FABRIC_SUCCESS;
}

// Utility functions
const char *peer_behavior_type_to_string(PeerBehaviorType behavior)
{
  if (behavior >= 0 && behavior < PEER_BEHAVIOR_COUNT)
  {
    return BEHAVIOR_TYPE_NAMES[behavior];
  }
  return "Unknown";
}

int32_t peer_behavior_get_default_score(PeerBehaviorType behavior)
{
  if (behavior >= 0 && behavior < PEER_BEHAVIOR_COUNT)
  {
    return DEFAULT_BEHAVIOR_SCORES[behavior];
  }
  return 0;
}

bool peer_scoring_is_score_valid(int32_t score)
{
  return score >= PEER_SCORE_MIN && score <= PEER_SCORE_MAX;
}

FabricError peer_scoring_normalize_score(int32_t *score)
{
  FABRIC_CHECK_NULL(score);

  if (*score < PEER_SCORE_MIN)
  {
    *score = PEER_SCORE_MIN;
  }
  else if (*score > PEER_SCORE_MAX)
  {
    *score = PEER_SCORE_MAX;
  }

  return FABRIC_SUCCESS;
}

// Configuration functions
FabricError peer_scoring_set_auto_cleanup(PeerScoringSystem *system, bool enabled, uint32_t interval)
{
  FABRIC_CHECK_NULL(system);

  system->auto_cleanup_enabled = enabled;
  system->cleanup_interval = interval;

  return FABRIC_SUCCESS;
}

FabricError peer_scoring_set_max_peers(PeerScoringSystem *system, uint32_t max_peers)
{
  FABRIC_CHECK_NULL(system);

  if (max_peers == 0)
  {
    return FABRIC_ERROR_INVALID_ARGUMENT;
  }

  if (max_peers < system->peer_count)
  {
    return FABRIC_ERROR_INVALID_ARGUMENT;
  }

  PeerScoringContext **new_peers = realloc(system->peers, max_peers * sizeof(PeerScoringContext *));
  if (!new_peers)
  {
    return FABRIC_ERROR_OUT_OF_MEMORY;
  }

  system->peers = new_peers;
  system->peer_capacity = max_peers;
  system->max_peers = max_peers;

  return FABRIC_SUCCESS;
}
