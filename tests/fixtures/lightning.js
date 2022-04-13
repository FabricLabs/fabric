'use strict';

const GENESIS_HASH = '0100000000000000000000000000000000000000000000000000000000000000000000003ba3edfd7a7b12b27ac72c3e67768f617fc81bc3888a51323a9fb8aa4b1e5e4adae5494dffff7f20020000000101000000010000000000000000000000000000000000000000000000000000000000000000ffffffff4d04ffff001d0104455468652054696d65732030332f4a616e2f32303039204368616e63656c6c6f72206f6e206272696e6b206f66207365636f6e64206261696c6f757420666f722062616e6b73ffffffff0100f2052a01000000434104678afdb0fe5548271967f1a67130b7105cd';
const BLOCK_ONE = '0000002006226e46111a0b59caaf126043eb5bbf28c34f3a5e332a1fc7b2b73cf188910fadbb20ea41a8423ea937e76e8151636bf6093b70eaff942930d20576600521fdc30f9858ffff7f20000000000101000000010000000000000000000000000000000000000000000000000000000000000000ffffffff03510101ffffffff0100f2052a010000001976a9143ca33c2e4446f4a305f23c80df8ad1afdcf652f988ac00000000';
const BLOCK_ONE_COINBASE = '01000000010000000000000000000000000000000000000000000000000000000000000000ffffffff03510101ffffffff0100f2052a010000001976a9143ca33c2e4446f4a305f23c80df8ad1afdcf652f988ac00000000';
const BLOCK_ONE_PRIVKEY = '6bd078650fcee8444e4e09825227b801a1ca928debb750eb36e6d56124bb20e801';
const BLOCK_ONE_PRIVKEY_BASE58 = 'cRCH7YNcarfvaiY1GWUKQrRGmoezvfAiqHtdRvxe16shzbd7LDMz';

const LOCAL_FUNDING_PUBKEY = '023da092f6980e58d2c037173180e9a465476026ee50f96695963e8efe436f54eb';
const REMOTE_FUNDING_PUBKEY = '030e9f7b623d2ccc7c9bd44d66d5ce21ce504c0acf6385a132cec6d3c39fa711c1';
const FUNDING_WITNESS_SCRIPT = '5221023da092f6980e58d2c037173180e9a465476026ee50f96695963e8efe436f54eb21030e9f7b623d2ccc7c9bd44d66d5ce21ce504c0acf6385a132cec6d3c39fa711c152ae';

const FUNDING_INPUT_TXID = 'fd2105607605d2302994ffea703b09f66b6351816ee737a93e42a841ea20bbad';
const FUNDING_INPUT_INDEX = 0;
const FUNDING_INPUT_SATOSHIS = 5000000000;
const FUNDING_INPUT_FUNDING_SATOSHIS = 10000000;
const FUNDING_INPUT_WITNESS_SCRIPT = '5221023da092f6980e58d2c037173180e9a465476026ee50f96695963e8efe436f54eb21030e9f7b623d2ccc7c9bd44d66d5ce21ce504c0acf6385a132cec6d3c39fa711c152ae';
const FUNDING_FEERATE_PER_KW = 15000;
const FUNDING_CHANGE_SATOSHIS = 4989986080;
const FUNDING_OUTPUT_INDEX = 0;

const FUNDING_TX = '0200000001adbb20ea41a8423ea937e76e8151636bf6093b70eaff942930d20576600521fd000000006b48304502210090587b6201e166ad6af0227d3036a9454223d49a1f11839c1a362184340ef0240220577f7cd5cca78719405cbf1de7414ac027f0239ef6e214c90fcaab0454d84b3b012103535b32d5eb0a6ed0982a0479bbadc9868d9836f6ba94dd5a63be16d875069184ffffffff028096980000000000220020c015c4a6be010e21657068fc2e6a9d02b27ebe4d490a25846f7237f104d1a3cd20256d29010000001600143ca33c2e4446f4a305f23c80df8ad1afdcf652f900000000';
const FUNDING_TXID = '8984484a580b825b9972d7adb15050b3ab624ccd731946b3eeddb92f4e7ef6be';

const LOCAL_FUNDING_PRIVKEY = '30ff4956bbdd3222d44cc5e8a1261dab1e07957bdac5ae88fe3261ef321f374901';
const LOCAL_PRIVKEY = 'bb13b121cdc357cd2e608b0aea294afca36e2b34cf958e2e6451a2f27469449101';
const LOCALPUBKEY = '030d417a46946384f88d5f3337267c5e579765875dc4daca813e21734b140639e7';
const REMOTEPUBKEY = '0394854aa6eab5b2a8122cc726e9dded053a2184d88256816826d6231c068d4a5b';
const LOCAL_DELAYEDPUBKEY = '03fd5960528dc152014952efdb702a88f71e3c1653b2314431701ec77e57fde83c';
const LOCAL_REVOCATION_PUBKEY = '0212a140cd0c6539d07cd08dfe09984dec3251ea808b892efeac3ede9402bf2b19';
// TODO: test same as before
// const FUNDING_WITNESS_SCRIPT = '5221023da092f6980e58d2c037173180e9a465476026ee50f96695963e8efe436f54eb21030e9f7b623d2ccc7c9bd44d66d5ce21ce504c0acf6385a132cec6d3c39fa711c152ae';

const LOCAL_PAYMENT_BASEPOINT = '034f355bdcb7cc0af728ef3cceb9615d90684bb5b2ca5f859ab0f0b704075871aa';
const REMOTE_PAYMENT_BASEPOINT = '032c0b7cf95324a07d05398b240174dc0c2be444d96b159aa6c7f7b1e668680991';
const OBSCURED_COMMITMENT_NUMBER = Math.pow(0x2bb038521914, 42);

module.exports = {
  GENESIS_HASH,
  BLOCK_ONE,
  BLOCK_ONE_COINBASE,
  BLOCK_ONE_PRIVKEY,
  BLOCK_ONE_PRIVKEY_BASE58,
  REMOTE_FUNDING_PUBKEY,
  FUNDING_WITNESS_SCRIPT,
  FUNDING_INPUT_TXID,
  FUNDING_INPUT_INDEX,
  FUNDING_INPUT_SATOSHIS,
  FUNDING_INPUT_FUNDING_SATOSHIS,
  FUNDING_INPUT_WITNESS_SCRIPT,
  FUNDING_FEERATE_PER_KW,
  FUNDING_CHANGE_SATOSHIS,
  FUNDING_OUTPUT_INDEX,
  FUNDING_TX,
  FUNDING_TXID,
  LOCAL_FUNDING_PRIVKEY,
  LOCAL_FUNDING_PUBKEY,
  REMOTE_FUNDING_PUBKEY,
  LOCAL_PRIVKEY,
  LOCALPUBKEY,
  REMOTEPUBKEY,
  LOCAL_DELAYEDPUBKEY,
  LOCAL_REVOCATION_PUBKEY,
  LOCAL_PAYMENT_BASEPOINT,
  REMOTE_PAYMENT_BASEPOINT,
  OBSCURED_COMMITMENT_NUMBER
};
