#ifndef FABRIC_DATADIR_H
#define FABRIC_DATADIR_H

#include <stddef.h>
#include "errors.h"

// Set a process-wide preferred datadir (overrides env/defaults)
FabricError fabric_set_global_datadir(const char *path);

// Get the effective datadir:
// 1) global override if set
// 2) FABRIC_DATADIR env var if set
// 3) $HOME/.fabric if HOME set
// 4) ./.fabric in current working directory
// Ensures the directory exists.
FabricError fabric_get_default_datadir(char *out_path, size_t out_size);

// Ensure directory exists (mkdir -p semantics for simple paths)
FabricError fabric_ensure_dir(const char *path);

#endif // FABRIC_DATADIR_H


