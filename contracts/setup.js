// Program Definition
async function OP_SETUP (command = {}) {
  const environment = this;
  const walletExists = environment.walletExists(); // Generic / Global
  const any = (candidate => (candidate && typeof candidate !== 'undefined'));
  const name = 'wallet.json';

  // TODO: use in walletExists
  const destination = [
    environment.readVariable('FABRIC_WALLET')
  ].find(any) || `${environment.readVariable('HOME')}/.fabric/${name}`;

  const seed = [
    command.seed,
    environment.seed,
    environment['FABRIC_SEED'],
    environment.readVariable('FABRIC_SEED')
  ].find(any);

  try {
    wallet = environment.readWallet();
  } catch (exception) {
    console.error(exception);
  }

  if (!walletExists) {
    const file = JSON.stringify({
      '@type': 'WalletStore',
      '@data': {
        seed: null,
        master: null,
        key: {
          private: null
        }
      }
    }, null, '  ') + '\n';

    const buffer = Buffer.from(file, 'utf8');
    const hash = crypto.createHash('sha256').update(buffer).digest('hex');

    console.log('Wallet Exists!');
  }

  // Report to console
  console.log(`Wallet: [${(wallet) ? wallet.id : 'unknown' }]:`, wallet);

  // Success!
  return 1;
}

// Module
module.exports = OP_SETUP;
