#include "cli.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <time.h>
#include <signal.h>
#include <locale.h>

// Global CLI instance for signal handling
static FabricCLI *g_cli = NULL;

// Signal handler for graceful shutdown
static void signal_handler(int sig)
{
  (void)sig;
  if (g_cli)
  {
    cli_stop(g_cli);
  }
}

// Initialize ncurses and create windows
static int init_ncurses_and_windows(FabricCLI *cli)
{
  // Set locale for proper character support
  setlocale(LC_ALL, "");

  initscr();
  noecho();
  cbreak();
  keypad(stdscr, TRUE);
  curs_set(0);

  if (has_colors())
  {
    start_color();
    init_pair(1, COLOR_WHITE, COLOR_BLACK);  // Normal text
    init_pair(2, COLOR_RED, COLOR_BLACK);    // Error
    init_pair(3, COLOR_YELLOW, COLOR_BLACK); // Warning
    init_pair(4, COLOR_GREEN, COLOR_BLACK);  // Success
    init_pair(5, COLOR_CYAN, COLOR_BLACK);   // Input
  }

  // Get terminal dimensions
  int max_y, max_x;
  getmaxyx(stdscr, max_y, max_x);

  // Create windows
  cli->status_win = newwin(1, max_x, 0, 0);
  cli->content_win = newwin(max_y - 3, max_x, 1, 0);
  cli->input_win = newwin(2, max_x, max_y - 2, 0);

  if (!cli->status_win || !cli->content_win || !cli->input_win)
  {
    return -1;
  }

  // Set window properties
  scrollok(cli->content_win, TRUE);
  nodelay(cli->input_win, TRUE); // Make input non-blocking

  return 0;
}

// Cleanup ncurses
static void cleanup_ncurses(void)
{
  endwin();
}

// Create and initialize CLI
FabricCLI *cli_create(void)
{
  FabricCLI *cli = calloc(1, sizeof(FabricCLI));
  if (!cli)
    return NULL;

  // Initialize state
  memset(&cli->state, 0, sizeof(CLIState));
  cli->state.cursor_pos = 0;
  cli->state.scroll_offset = 0;
  cli->state.needs_redraw = true;
  cli->state.message_count = 0;

  // Set default values
  strcpy(cli->state.identity, "anonymous");
  strcpy(cli->state.balance, "0.00");
  strcpy(cli->state.network, "local");

  // Initialize peer system
  cli->state.peer = peer_create();
  cli->state.listening_port = 0;
  cli->state.is_listening = false;

  // Generate keypair for the peer
  if (cli->state.peer)
  {
    FabricError key_result = peer_generate_keypair(cli->state.peer);
    FabricError scoring_result = peer_init_scoring(cli->state.peer, 100); // Initialize with max 100 peers

    if (key_result != FABRIC_SUCCESS)
    {
      fprintf(stderr, "Failed to generate peer keypair: %d\n", key_result);
    }
    if (scoring_result != FABRIC_SUCCESS)
    {
      fprintf(stderr, "Failed to initialize peer scoring: %d\n", scoring_result);
    }
  }
  else
  {
    fprintf(stderr, "Failed to create peer\n");
  }

  // Initialize mutex
  if (pthread_mutex_init(&cli->state.mutex, NULL) != 0)
  {
    if (cli->state.peer)
      peer_destroy(cli->state.peer);
    free(cli);
    return NULL;
  }

  // Windows will be created after ncurses is initialized
  cli->status_win = NULL;
  cli->content_win = NULL;
  cli->input_win = NULL;

  cli->running = false;
  return cli;
}

// Destroy CLI and cleanup resources
void cli_destroy(FabricCLI *cli)
{
  if (!cli)
    return;

  // Destroy windows
  if (cli->status_win)
    delwin(cli->status_win);
  if (cli->content_win)
    delwin(cli->content_win);
  if (cli->input_win)
    delwin(cli->input_win);

  // Destroy peer system
  if (cli->state.peer)
  {
    // Stop listening if we were listening
    if (cli->state.is_listening) {
      peer_stop_listening(cli->state.peer);
    }
    peer_destroy(cli->state.peer);
  }

  // Destroy mutex
  pthread_mutex_destroy(&cli->state.mutex);

  free(cli);
}

// Add a message to the log
void cli_add_message(FabricCLI *cli, const char *content, const char *actor, bool is_error, bool is_warning)
{
  if (!cli || !content)
    return;

  pthread_mutex_lock(&cli->state.mutex);

  // Shift messages if buffer is full
  if (cli->state.message_count >= 100)
  {
    for (int i = 0; i < 99; i++)
    {
      cli->state.messages[i] = cli->state.messages[i + 1];
    }
    cli->state.message_count = 99;
  }

  // Add new message
  CLIMessage *msg = &cli->state.messages[cli->state.message_count];
  strncpy(msg->content, content, sizeof(msg->content) - 1);
  msg->content[sizeof(msg->content) - 1] = '\0';

  if (actor)
  {
    strncpy(msg->actor, actor, sizeof(msg->actor) - 1);
    msg->actor[sizeof(msg->actor) - 1] = '\0';
  }
  else
  {
    strcpy(msg->actor, "system");
  }

  msg->timestamp = time(NULL);
  msg->is_error = is_error;
  msg->is_warning = is_warning;

  cli->state.message_count++;
  cli->state.needs_redraw = true;

  pthread_mutex_unlock(&cli->state.mutex);
}

// Set input text
void cli_set_input(FabricCLI *cli, const char *input)
{
  if (!cli || !input)
    return;

  pthread_mutex_lock(&cli->state.mutex);
  strncpy(cli->state.input_buffer, input, sizeof(cli->state.input_buffer) - 1);
  cli->state.input_buffer[sizeof(cli->state.input_buffer) - 1] = '\0';
  cli->state.cursor_pos = strlen(cli->state.input_buffer);
  cli->state.needs_redraw = true;
  pthread_mutex_unlock(&cli->state.mutex);
}

// Clear input
void cli_clear_input(FabricCLI *cli)
{
  if (!cli)
    return;

  pthread_mutex_lock(&cli->state.mutex);
  memset(cli->state.input_buffer, 0, sizeof(cli->state.input_buffer));
  cli->state.cursor_pos = 0;
  cli->state.needs_redraw = true;
  pthread_mutex_unlock(&cli->state.mutex);
}

// Render the CLI interface
void cli_render(FabricCLI *cli)
{
  if (!cli)
    return;

  pthread_mutex_lock(&cli->state.mutex);

  // Render status bar
  wclear(cli->status_win);
  wprintw(cli->status_win, " Fabric CLI | Identity: %s | Balance: %s | Network: %s ",
          cli->state.identity, cli->state.balance, cli->state.network);
  wrefresh(cli->status_win);

  // Render content area (log)
  wclear(cli->content_win);
  int max_y, max_x;
  getmaxyx(cli->content_win, max_y, max_x);

  int display_lines = max_y - 2;
  int start_idx = 0;
  if (cli->state.message_count > display_lines)
  {
    start_idx = cli->state.message_count - display_lines;
  }

  for (int i = start_idx; i < cli->state.message_count; i++)
  {
    CLIMessage *msg = &cli->state.messages[i];
    struct tm *tm_info = localtime(&msg->timestamp);
    char time_str[9];
    strftime(time_str, sizeof(time_str), "%H:%M:%S", tm_info);

    // Choose color based on message type
    int color_pair = 1; // Normal
    if (msg->is_error)
      color_pair = 2; // Red
    else if (msg->is_warning)
      color_pair = 3; // Yellow

    wattron(cli->content_win, COLOR_PAIR(color_pair));
    wprintw(cli->content_win, "[%s] %s: %s\n", time_str, msg->actor, msg->content);
    wattroff(cli->content_win, COLOR_PAIR(color_pair));
  }
  wrefresh(cli->content_win);

  // Render input area
  wclear(cli->input_win);
  wprintw(cli->input_win, "> ");
  wprintw(cli->input_win, "%s", cli->state.input_buffer);

  // Position cursor
  wmove(cli->input_win, 0, 2 + cli->state.cursor_pos);
  wrefresh(cli->input_win);

  cli->state.needs_redraw = false;
  pthread_mutex_unlock(&cli->state.mutex);
}

// Handle input processing
static void process_input(FabricCLI *cli, int ch)
{
  if (!cli)
    return;

  pthread_mutex_lock(&cli->state.mutex);

  switch (ch)
  {
  case 27: // Escape key
    cli->running = false;
    break;

  case KEY_BACKSPACE:
  case 127: // Delete key
    if (cli->state.cursor_pos > 0)
    {
      cli->state.cursor_pos--;
      cli->state.input_buffer[cli->state.cursor_pos] = '\0';
    }
    break;

  case KEY_LEFT:
    if (cli->state.cursor_pos > 0)
    {
      cli->state.cursor_pos--;
    }
    break;

  case KEY_RIGHT:
    if (cli->state.cursor_pos < (int)strlen(cli->state.input_buffer))
    {
      cli->state.cursor_pos++;
    }
    break;

  case '\n':
  case '\r':
    if (strlen(cli->state.input_buffer) > 0)
    {
      // Save command to process after unlocking mutex
      char command[256];
      char identity[64];
      char status_message[256] = {0}; // For storing status messages to display after unlock
      bool is_error_message = false;
      strncpy(command, cli->state.input_buffer, sizeof(command) - 1);
      command[sizeof(command) - 1] = '\0';
      strncpy(identity, cli->state.identity, sizeof(identity) - 1);
      identity[sizeof(identity) - 1] = '\0';

      // Simple command processing
      if (strcmp(cli->state.input_buffer, "quit") == 0 ||
          strcmp(cli->state.input_buffer, "exit") == 0)
      {
        cli->running = false;
      }
      else if (strcmp(cli->state.input_buffer, "clear") == 0)
      {
        cli->state.message_count = 0;
      }
      else if (strcmp(cli->state.input_buffer, "help") == 0)
      {
        // Help information is shown in the welcome messages
        strncpy(status_message, "Available commands: identity, balance, network, clear, listen, stop, connect, broadcast, quit", sizeof(status_message) - 1);
      }
      else if (strncmp(cli->state.input_buffer, "identity ", 9) == 0)
      {
        strncpy(cli->state.identity, cli->state.input_buffer + 9, sizeof(cli->state.identity) - 1);
        cli->state.identity[sizeof(cli->state.identity) - 1] = '\0';
      }
      else if (strncmp(cli->state.input_buffer, "balance ", 8) == 0)
      {
        strncpy(cli->state.balance, cli->state.input_buffer + 8, sizeof(cli->state.balance) - 1);
        cli->state.balance[sizeof(cli->state.balance) - 1] = '\0';
      }
      else if (strncmp(cli->state.input_buffer, "network ", 8) == 0)
      {
        strncpy(cli->state.network, cli->state.input_buffer + 8, sizeof(cli->state.network) - 1);
        cli->state.network[sizeof(cli->state.network) - 1] = '\0';
      }

      // Clear input
      memset(cli->state.input_buffer, 0, sizeof(cli->state.input_buffer));
      cli->state.cursor_pos = 0;

      // Force immediate redraw
      cli->state.needs_redraw = true;

      // Unlock mutex before calling cli_add_message
      pthread_mutex_unlock(&cli->state.mutex);

      // Add message to log (this will lock/unlock its own mutex)
      cli_add_message(cli, command, identity, false, false);

      // Add status message if we have one
      if (strlen(status_message) > 0)
      {
        cli_add_message(cli, status_message, "system", is_error_message, false);
      }

      // Return early since we already unlocked
      return;
    }
    break;

  default:
    if (ch >= 32 && ch <= 126 &&
        cli->state.cursor_pos < (int)(sizeof(cli->state.input_buffer) - 1))
    {
      // Insert character
      memmove(&cli->state.input_buffer[cli->state.cursor_pos + 1],
              &cli->state.input_buffer[cli->state.cursor_pos],
              strlen(&cli->state.input_buffer[cli->state.cursor_pos]) + 1);
      cli->state.input_buffer[cli->state.cursor_pos] = ch;
      cli->state.cursor_pos++;
    }
    break;
  }

  cli->state.needs_redraw = true;
  pthread_mutex_unlock(&cli->state.mutex);
}

// Start the CLI main loop
int cli_start(FabricCLI *cli)
{
  if (!cli)
    return -1;

  // Set up signal handling
  g_cli = cli;
  signal(SIGINT, signal_handler);
  signal(SIGTERM, signal_handler);

  // Initialize ncurses and create windows
  if (init_ncurses_and_windows(cli) != 0)
  {
    return -1;
  }

  cli->running = true;

  // Add welcome message
  cli_add_message(cli, "Fabric CLI started. Type 'help' for commands or 'quit' to exit.", "system", false, false);
  cli_add_message(cli, "Available commands: identity <name>, balance <amount>, network <name>, clear, quit", "system", false, false);
  cli_add_message(cli, "Peer commands: listen <port>, stop, connect <host:port>, broadcast <message>", "system", false, false);

  // Main event loop
  while (cli->running)
  {
    // Render if needed
    if (cli->state.needs_redraw)
    {
      cli_render(cli);
    }

    // Handle input (non-blocking)
    int ch = wgetch(cli->input_win);
    if (ch != ERR)
    {
      process_input(cli, ch);
    }

    // Process peer events
    cli_process_peer_events(cli);

    // Small delay to prevent high CPU usage
    usleep(10000); // 10ms
  }

  // Cleanup
  cleanup_ncurses();
  g_cli = NULL;

  return 0;
}

// Stop the CLI
void cli_stop(FabricCLI *cli)
{
  if (!cli)
    return;
  cli->running = false;
}
