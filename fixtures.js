'use strict';

// Zero Entropy
const TEST_SEED = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const TEST_XPRV = 'xprv9s21ZrQH143K3h3fDYiay8mocZ3afhfULfb5GX8kCBdno77K4HiA15Tg23wpbeF1pLfs1c5SPmYHrEpTuuRhxMwvKDwqdKiGJS9XFKzUsAF';
const TEST_XPUB = 'xpub661MyMwAqRbcFtXgS5sYJABqqG9YLmC4Q1Rdap9gSE8NqtwybGhePY2gZ29ESFjqJoCu1Rupje8YtGqsefD265TMg7usUDFdp6W1EGMcet8';

// Strings
const EMPTY_STRING = '';
const FABRIC_HELLO_WORLD = 'Hello, World!';
const HELLO_FABRIC = 'Hello, Fabric!';
const HELLO_WORLD = 'Hello World';
const GITHUB_ISSUE_PATH = 'FabricLabs/fabric/issues/1';

// Module
module.exports = {
  EMPTY_STRING: EMPTY_STRING,
  FABRIC_HELLO_WORLD: FABRIC_HELLO_WORLD,
  FABRIC_SEED: TEST_SEED,
  FABRIC_XPRV: TEST_SEED,
  FABRIC_XPUB: TEST_SEED,
  FIXTURE_SEED: TEST_SEED,
  GITHUB_ISSUE_PATH: GITHUB_ISSUE_PATH,
  HELLO_FABRIC: HELLO_FABRIC,
  HELLO_WORLD: HELLO_WORLD,
  PLAYNET_SEED: TEST_SEED,
  TEST_SEED: TEST_SEED,
  seed: TEST_SEED,
  xprv: TEST_XPRV,
  identity: {
    xpub: TEST_XPUB
  }
};
