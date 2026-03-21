#ifndef CLI_H
#define CLI_H

#include <ncurses.h>
#include <stdbool.h>
#include <pthread.h>
#include "peer.h"
#include "message.h"

// Simple message structure
typedef struct
{
  char content[256];
  char actor[64];
  time_t timestamp;
  bool is_error;
  bool is_warning;
} CLIMessage;

// Clean CLI state - single source of truth
typedef struct
{
  // Input state
  char input_buffer[256];
  int cursor_pos;

  // Display state
  int scroll_offset;
  bool needs_redraw;

  // Message history
  CLIMessage messages[100];
  int message_count;

  // System info
  char identity[64];
  char balance[32];
  char network[32];

  // Peer system
  Peer *peer;
  int listening_port;
  bool is_listening;

  // Mutex for thread safety
  pthread_mutex_t mutex;
} CLIState;

// Main CLI structure
typedef struct
{
  CLIState state;
  WINDOW *status_win;
  WINDOW *content_win;
  WINDOW *input_win;
  bool running;
} FabricCLI;

// Core functions
FabricCLI *cli_create(void);
void cli_destroy(FabricCLI *cli);
int cli_start(FabricCLI *cli);
void cli_stop(FabricCLI *cli);

// State management
void cli_add_message(FabricCLI *cli, const char *content, const char *actor, bool is_error, bool is_warning);
void cli_set_input(FabricCLI *cli, const char *input);
void cli_clear_input(FabricCLI *cli);

// Process peer events from the peer system
void cli_process_peer_events(FabricCLI *cli);

// Rendering
void cli_render(FabricCLI *cli);

#endif // CLI_H
