#include "cli.h"
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#include <signal.h>

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

int main(int argc, char *argv[])
{
  (void)argc;
  (void)argv;

  printf("Starting Fabric CLI...\n");

  // Create CLI instance
  FabricCLI *cli = cli_create();
  if (!cli)
  {
    fprintf(stderr, "Failed to create CLI\n");
    return 1;
  }

  g_cli = cli;

  // Set up signal handling
  signal(SIGINT, signal_handler);
  signal(SIGTERM, signal_handler);

  printf("CLI created successfully. Starting TUI...\n");

  // Start the CLI (this will enter the ncurses TUI)
  int result = cli_start(cli);

  // Cleanup
  cli_destroy(cli);
  g_cli = NULL;

  printf("CLI exited with result: %d\n", result);
  return result;
}
