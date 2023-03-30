'use strict';

// # Importing the Environment type
const Environment = require('@fabric/core/types/environment');

// Define 
async function main () {
  // Create an instance
  const environment = new Environment();

  // Create an object containing our output
  return {
    // As with all Fabric types, the `id` property is deterministic, being
    // derived from the `settings` object as provided to the constructor.
    id: environment.id,
    // If the environment provides a wallet, it will be listed here
    wallet: environment.wallet?.id
  };
}

// Run the example
main().catch((exception) => {
  console.error('[EXAMPLE:ENVIRONMENT]', '[EXCEPTION]', exception);
}).then((output) => {
  console.log('[EXAMPLE:ENVIRONMENT]', '[OUTPUT]', output);
});
