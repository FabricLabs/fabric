'use strict';

const bcoin = require('bcoin/lib/bcoin-browser');
const crypto = require('crypto');

/**
 * The {@link Swap} contract executes a set of transactions on two distinct
 * {@link Chain} components, utilizing a secret-reveal mechanism to atomically
 * execute either the full set or none.
 * @type {Object}
 */
class Swap {
  /**
   * Atomically execute a set of transactions across two {@link Chain} components.
   * @param  {Object} [settings={}] Configuration for the swap.
   */
  constructor (settings = {}) {
    this.settings = Object.assign({
      chain: 'bitcoin:regtest'
    }, settings);

    this.status = 'unconfigured';

    return this;
  }

  /**
   * Find an input from the provided transaction which spends from the target
   * P2SH address.
   * @param  {Transaction} tx      {@link Transaction} to iterate over.
   * @param  {String} address P2SH address to search for.
   * @return {Mixed}         False on failure, secret value on success.
   */
  extractSecret (tx, address) {
    // Find the input that spends from the P2SH address
    for (const input of tx.inputs) {
      const inputJSON = input.getJSON();
      const inAddr = inputJSON.address;
      // Once we find it, return the second script item (the secret)
      if (inAddr === address) {
        return input.script.code[1].data;
      }
    }
    return false;
  }

  // Generate a random secret and derive its SHA-256 hash
  getSecret () {
    const secret = crypto.randomBytes(32);
    const hash = crypto.createHash('sha256').update(secret).digest('hex');

    return {
      'secret': secret,
      'hash': hash
    };
  }

  // Generate an ECDSA public / private key pair
  getKeyPair () {
    // Generate new random private key
    const master = this.hd.generate();
    const key = master.derivePath('m/44/0/0/0/0');
    const privateKey = key.privateKey;

    // Derive public key from private key
    const keyring = bcoin.KeyRing.fromPrivate(privateKey);
    const publicKey = keyring.publicKey;

    return {
      'publicKey': publicKey,
      'privateKey': privateKey
    };
  }

  // REDEEM script: the output of the swap HTLC
  getRedeemScript (hash, refundPubkey, swapPubkey, locktime) {
    const redeem = new bcoin.Script();

    redeem.pushSym('OP_IF');
    redeem.pushSym('OP_SHA256');
    redeem.pushData(hash);
    redeem.pushSym('OP_EQUALVERIFY');
    redeem.pushData(swapPubkey);
    redeem.pushSym('OP_ELSE');
    redeem.pushInt(locktime);
    redeem.pushSym('OP_CHECKSEQUENCEVERIFY');
    redeem.pushSym('OP_DROP');
    redeem.pushData(refundPubkey);
    redeem.pushSym('OP_ENDIF');
    redeem.pushSym('OP_CHECKSIG');

    redeem.compile();

    return redeem;
  }

  // SWAP script: used by counterparty to open the hash lock
  getSwapInputScript (redeemScript, secret) {
    const inputSwap = new bcoin.Script();

    inputSwap.pushInt(0); // signature placeholder
    inputSwap.pushData(secret);
    inputSwap.pushInt(1); // <true>
    inputSwap.pushData(redeemScript.toRaw()); // P2SH
    inputSwap.compile();

    return inputSwap;
  }

  // REFUND script: used by original sender of funds to open time lock
  getRefundInputScript (redeemScript) {
    const inputRefund = new bcoin.Script();

    inputRefund.pushInt(0); // signature placeholder
    inputRefund.pushInt(0); // <false>
    inputRefund.pushData(redeemScript.toRaw()); // P2SH
    inputRefund.compile();

    return inputRefund;
  }

  getAddressFromRedeemScript (redeemScript) {
    // P2SH wrapper around 160-bit hash of serialized redeem script
    return bcoin.Address.fromScripthash(redeemScript.hash160());
  }

  signInput (mtx, index, redeemScript, value, privateKey, sigHashType, versionOrFlags) {
    return mtx.signature(index, redeemScript, value, privateKey, sigHashType, versionOrFlags);
  }

  // Works for both refund and swap
  getRedeemTX (address, fee, fundingTX, fundingTXoutput, redeemScript, inputScript, locktime, privateKey) {
    const redeemTX = new bcoin.MTX();
    const coin = bcoin.Coin.fromTX(fundingTX, fundingTXoutput, -1);

    // Add that coin as an input to our transaction
    redeemTX.addCoin(coin);

    // Redeem the input coin with either the swap or refund script
    redeemTX.inputs[0].script = inputScript;

    // Create the output back to our primary wallet
    redeemTX.addOutput({
      address: address,
      value: coin.value - fee
    });

    // If this was a refund redemption we need to set the sequence
    // Sequence is the relative timelock value applied to individual inputs
    if (locktime) {
      redeemTX.setSequence(0, locktime, false);
    } else {
      redeemTX.inputs[0].sequence = 0xffffffff;
    }

    // Set SIGHASH and replay protection bits
    let versionOrFlags = 0;
    let type = null;

    if (this.chain.split(':')[0] === 'bcash') {
      versionOrFlags = this.flags;
      type = this.Script.hashType.SIGHASH_FORKID | this.Script.hashType.ALL;
    }

    // Create the signature authorizing the input script to spend the coin
    const sig = this.signInput(redeemTX, 0, redeemScript, coin.value, privateKey, type, versionOrFlags);

    // Insert the signature into the input script where we had a `0` placeholder
    inputScript.setData(0, sig);
    inputScript.compile();

    return redeemTX;
  }

  verifyMTX (mtx) {
    return mtx.verify(this.flags);
  }
}

module.exports = Swap;
