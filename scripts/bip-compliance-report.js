'use strict';

/**
 * BIP compliance report for the Fabric stack.
 *
 * Selection: from the public bitcoin/bips catalog (~210 proposals), keep only
 * Deployed/Complete Application + consensus soft-fork standards that wallets,
 * exchanges, and payment apps commonly implement — then score Fabric components
 * against that short list at graded compliance degrees.
 *
 * Usage:
 *   node scripts/bip-compliance-report.js
 *   npm run report:bip-compliance
 *
 * Optional sibling roots (defaults: ~/hub.fabric.pub, ~/fabric-browser-extension;
 * set FABRIC_APPLICATION for a product/app tree):
 *   FABRIC_HUB=/path FABRIC_PASSPORT=/path FABRIC_APPLICATION=/path
 *
 * Writes:
 *   reports/bip-compliance.json
 *   reports/bip-compliance.md
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const REPORTS = path.join(ROOT, 'reports');

/** @typedef {'universal'|'common'|'specialized'|'emerging'} AdoptionTier */
/** @typedef {'full'|'strong'|'partial'|'dependent'|'absent'|'n/a'} ComplianceLevel */
/** @typedef {'core'|'hub'|'passport'|'application'} ComponentId */

/**
 * Curated evaluation suite.
 * Sourced from bitcoin/bips README statuses (Deployed/Complete), industry wallet
 * checklists (Coldcard / Trezor / wallet-interop), and Fabric product surfaces.
 * Process, mining-only, Closed, and obsolete BIP-70 payment-protocol suites are
 * intentionally excluded from scoring (listed in EXCLUDED_NOTES).
 *
 * @type {Array<{
 *   bip: number,
 *   title: string,
 *   status: string,
 *   layer: string,
 *   adoption: AdoptionTier,
 *   why: string,
 *   patterns: string[],
 *   expected: Record<ComponentId, ComplianceLevel>,
 *   notes?: string
 * }>}
 */
const EVALUATION_SUITE = [
  {
    bip: 21,
    title: 'URI Scheme',
    status: 'Deployed (BIP-20 superseded; BIP-321 Complete successor)',
    layer: 'Applications',
    adoption: 'universal',
    why: 'Default payment deep-link / QR format across wallets.',
    patterns: ['functions/bip21', 'encodeBitcoinUri', 'parseBitcoinUri', 'bitcoin:', 'BIP21', 'bip21', 'bitcoinUri'],
    expected: { core: 'full', hub: 'strong', passport: 'absent', application: 'partial' },
    notes: 'Core functions/bip21.js encode/parse; inventory HTLC funding hints emit bitcoin: URIs with amount=. Passport uses fabric: deep links, not bitcoin:.'
  },
  {
    bip: 32,
    title: 'Hierarchical Deterministic Wallets',
    status: 'Deployed',
    layer: 'Applications',
    adoption: 'universal',
    why: 'Foundation of modern wallet backup and xpub watch-only.',
    patterns: ['functions/bip32', 'BIP32', 'bip32', 'fromSeed', 'xprv', 'xpub'],
    expected: { core: 'full', hub: 'strong', passport: 'full', application: 'strong' },
    notes: 'Core ships functions/bip32.js + BIP32 test vectors; Passport tests vectors.'
  },
  {
    bip: 39,
    title: 'Mnemonic code for generating deterministic keys',
    status: 'Deployed',
    layer: 'Applications',
    adoption: 'universal',
    why: 'Industry-standard recovery phrases (12/24 words).',
    patterns: ['functions/bip39', 'BIP39', 'bip39', 'generateMnemonic', 'validateMnemonic', 'mnemonicToSeed'],
    expected: { core: 'full', hub: 'strong', passport: 'full', application: 'strong' },
    notes: 'Core functions/bip39.js with English wordlist + NFKD passphrase tests.'
  },
  {
    bip: 43,
    title: 'Purpose Field for Deterministic Wallets',
    status: 'Deployed',
    layer: 'Applications',
    adoption: 'universal',
    why: 'Purpose level (44/49/84/86) disambiguates account trees.',
    patterns: ['BIP43', "m/44'", "m/84'", "m/86'"],
    expected: { core: 'strong', hub: 'strong', passport: 'strong', application: 'partial' },
    notes: 'Fabric uses purpose 44 for identity (coin 7777 mainnet / 7778 other) and Bitcoin funds; Core also names BIP-49/84/86 fund path templates. Passport receive UI is BIP84.'
  },
  {
    bip: 44,
    title: 'Multi-Account Hierarchy for Deterministic Wallets',
    status: 'Deployed',
    layer: 'Applications',
    adoption: 'universal',
    why: 'Default multi-account path template; still dominant for legacy P2PKH + many apps.',
    patterns: ['BIP44', 'BITCOIN_KEY_DERIVATION_PATH', "m/44'/0'", "m/44'/7777'", "m/44'/7778'", 'bitcoinReceiveDerivationPath', 'fabricCoinTypeForNetwork', 'resolveFabricIdentityCoinType', 'fabricIdentityDerivationPath', 'fabricIdentityAccountPath'],
    expected: { core: 'full', hub: 'strong', passport: 'absent', application: 'strong' },
    notes: 'Core constants encode BIP44 Bitcoin funds + Fabric coin-type 7777 (mainnet) / 7778 (other) identity. Passport receive UI is BIP84, not BIP44 path templates.'
  },
  {
    bip: 49,
    title: 'Derivation scheme for P2WPKH-nested-in-P2SH',
    status: 'Deployed',
    layer: 'Applications',
    adoption: 'common',
    why: 'Wrapped SegWit path — still seen in older wallets / migrations.',
    patterns: ["m/49'", 'BIP49', 'p2sh-p2wpkh', 'bitcoinBip49ReceiveDerivationPath'],
    expected: { core: 'partial', hub: 'absent', passport: 'absent', application: 'absent' },
    notes: 'Named m/49\' path templates only. Default funds path remains BIP-44; no p2sh-p2wpkh payment helper.'
  },
  {
    bip: 65,
    title: 'OP_CHECKLOCKTIMEVERIFY',
    status: 'Deployed',
    layer: 'Consensus (soft fork)',
    adoption: 'universal',
    why: 'Absolute timelocks for channels, escrow, vaults.',
    patterns: ['BIP65', 'CLTV', 'CHECKLOCKTIMEVERIFY', '500000000', 'normalizeLock'],
    expected: { core: 'strong', hub: 'dependent', passport: 'n/a', application: 'partial' },
    notes: 'contractTaproot normalizeLock enforces BIP65 height/unix threshold.'
  },
  {
    bip: 67,
    title: 'Deterministic P2SH multisig via public key sorting',
    status: 'Complete',
    layer: 'Applications',
    adoption: 'common',
    why: 'Lexicographic pubkey sort for deterministic multisig scripts.',
    patterns: ['BIP67', 'functions/bip67', 'sortPubkeysBip67', 'lexicographically sorted', 'sorted validator', 'sorted keys', 'sortPub'],
    expected: { core: 'strong', hub: 'partial', passport: 'n/a', application: 'strong' },
    notes: 'Named sortPubkeysBip67; contractTaproot k-of-n leaves, ARC spend keys, and Beacon validators use it.'
  },
  {
    bip: 68,
    title: 'Relative lock-time (sequence)',
    status: 'Deployed',
    layer: 'Consensus (soft fork)',
    adoption: 'universal',
    why: 'CSV relative locks enable Lightning + vault decay ladders.',
    patterns: ['BIP68', 'relative-locktime', 'csvBlocks', 'BIP68 TYPE_FLAG'],
    expected: { core: 'strong', hub: 'dependent', passport: 'n/a', application: 'partial' }
  },
  {
    bip: 78,
    title: 'A Simple Payjoin Proposal',
    status: 'Deployed',
    layer: 'Applications',
    adoption: 'common',
    why: 'Dominant interactive Payjoin profile for privacy-preserving receives.',
    patterns: ['BIP78', 'Payjoin', 'payjoin', 'pj=', 'SubmitPayjoinProposal', 'autoAcpBoost'],
    expected: { core: 'partial', hub: 'strong', passport: 'absent', application: 'absent' },
    notes: 'Hub PayjoinService BIP78 text/plain I/O + absolute pj=; optional auto ACP on regtest.'
  },
  {
    bip: 77,
    title: 'Async Payjoin',
    status: 'Draft',
    layer: 'Applications',
    adoption: 'emerging',
    why: 'Next-gen Payjoin (directory + OHTTP); Hub ships experimental local mailbox first.',
    patterns: ['BIP77', 'asyncPayjoin', 'payjoinAsyncMailbox', 'bip77_async_mailbox', 'OHTTP'],
    expected: { core: 'absent', hub: 'partial', passport: 'absent', application: 'absent' },
    notes: 'Hub-local experimental opaque mailbox (enqueue/poll/markDelivered); not full directory/HPKE/OHTTP.'
  },
  {
    bip: 84,
    title: 'Derivation scheme for P2WPKH (native SegWit)',
    status: 'Deployed',
    layer: 'Applications',
    adoption: 'universal',
    why: 'Default receive path for modern bc1q wallets.',
    patterns: ['BIP84', "m/84'", 'p2wpkh', 'native SegWit', 'bitcoinBip84ReceiveDerivationPath'],
    expected: { core: 'strong', hub: 'partial', passport: 'strong', application: 'partial' },
    notes: 'Core names BIP-84 path templates; default Bitcoin funds path remains BIP-44. Passport derives BIP84 receive from xpub.'
  },
  {
    bip: 86,
    title: 'Key Derivation for Single-Key P2TR Outputs',
    status: 'Deployed',
    layer: 'Applications',
    adoption: 'common',
    why: 'Standard Taproot single-key receive path (bc1p).',
    patterns: ['BIP86', "m/86'", 'p2tr', 'bitcoinBip86ReceiveDerivationPath', 'Key Derivation for Single'],
    expected: { core: 'strong', hub: 'partial', passport: 'absent', application: 'absent' },
    notes: 'Named m/86\' receive/change templates; default funds path is still BIP-44. P2TR address generation exists separately. GoonCitizen has no BIP86 surface.'
  },
  {
    bip: 112,
    title: 'CHECKSEQUENCEVERIFY',
    status: 'Deployed',
    layer: 'Consensus (soft fork)',
    adoption: 'universal',
    why: 'Opcode companion to BIP68; required for relative-lock scripts.',
    patterns: ['CHECKSEQUENCEVERIFY', 'OP_CSV', 'BIP112'],
    expected: { core: 'strong', hub: 'dependent', passport: 'n/a', application: 'absent' }
  },
  {
    bip: 125,
    title: 'Opt-in Full Replace-by-Fee Signaling',
    status: 'Deployed',
    layer: 'Applications',
    adoption: 'common',
    why: 'Wallet fee-bumping interoperability via sequence signaling.',
    patterns: ['BIP125', 'functions/bip125', 'sequenceSignalsOptInRbf', 'BIP125_SEQUENCE_RBF', 'RBF', 'replace-by-fee', 'replaceByFee'],
    expected: { core: 'partial', hub: 'dependent', passport: 'absent', application: 'absent' },
    notes: 'Named nSequence helpers. Inventory HTLC refunds use locktime-only (MAX-1), which does not signal RBF. Spends are not RBF by default.'
  },
  {
    bip: 141,
    title: 'Segregated Witness (Consensus layer)',
    status: 'Deployed',
    layer: 'Consensus (soft fork)',
    adoption: 'universal',
    why: 'SegWit is baseline for modern tx weight, Lightning, and Taproot.',
    patterns: ['SegWit', 'BIP141', 'witness program', 'p2wpkh', 'p2wsh'],
    expected: { core: 'strong', hub: 'dependent', passport: 'strong', application: 'strong' }
  },
  {
    bip: 143,
    title: 'Transaction Signature Verification for Version 0 Witness Programs',
    status: 'Deployed',
    layer: 'Consensus (soft fork)',
    adoption: 'universal',
    why: 'SegWit v0 sighash rules used by bitcoinjs / bitcoind signing paths.',
    patterns: ['BIP143', 'sighash', 'witness v0', 'hashForWitnessV0'],
    expected: { core: 'dependent', hub: 'dependent', passport: 'dependent', application: 'dependent' },
    notes: 'Delegated to bitcoinjs-lib / bitcoind rather than a first-party BIP143 module.'
  },
  {
    bip: 173,
    title: 'Bech32 address format for native witness outputs',
    status: 'Deployed',
    layer: 'Applications',
    adoption: 'universal',
    why: 'bc1q encoding for SegWit v0.',
    patterns: ['functions/bech32', 'BIP 173', 'BIP173', 'bech32', 'segwit_addr'],
    expected: { core: 'full', hub: 'strong', passport: 'strong', application: 'strong' }
  },
  {
    bip: 174,
    title: 'Partially Signed Bitcoin Transaction Format',
    status: 'Deployed',
    layer: 'Applications',
    adoption: 'universal',
    why: 'Cross-wallet unsigned/partially-signed tx interchange.',
    patterns: ['Psbt', 'PSBT', 'BIP174', '_buildPSBT', 'decodepsbt', 'prepareInventoryHtlc'],
    expected: { core: 'strong', hub: 'strong', passport: 'absent', application: 'partial' },
    notes: 'Core wallet/Bitcoin service + contract Taproot/HTLC PSBT builders; Hub Payjoin uses PSBTs.'
  },
  {
    bip: 327,
    title: 'MuSig2 for BIP340-compatible Multi-Signatures',
    status: 'Deployed',
    layer: 'Applications',
    adoption: 'specialized',
    why: 'Interactive Schnorr multi-sig; relevant to Fabric federation / group signing narrative.',
    patterns: ['MuSig2', 'musig2', 'BIP327', 'MuSig'],
    expected: { core: 'full', hub: 'partial', passport: 'absent', application: 'partial' },
    notes: 'First-party BIP-327 in functions/musig2 (official vectors). Taproot n≥2 vaults use the MuSig2 aggregate as the internal key (cooperative n-of-n key-path); t-of-n stays CHECKSIGADD script-path. Beacon/GroupChange remain count-k BIP-340. P2P_MUSIG_* is dispatched on directed TCP (musig2Session + Peer).'
  },
  {
    bip: 340,
    title: 'Schnorr Signatures for secp256k1',
    status: 'Deployed',
    layer: 'Applications / Consensus',
    adoption: 'universal',
    why: 'Fabric Message / Peer authenticity + Taproot key-path signatures.',
    patterns: ['BIP340', 'BIP-340', 'Schnorr', 'signSchnorr', 'verifySchnorr', 'noble-curves'],
    expected: { core: 'full', hub: 'strong', passport: 'strong', application: 'strong' },
    notes: 'POLICY.md requires BIP-340 on Fabric messages; Key#signSchnorr / verify in core.'
  },
  {
    bip: 341,
    title: 'Taproot: SegWit version 1 spending rules',
    status: 'Deployed',
    layer: 'Consensus (soft fork)',
    adoption: 'universal',
    why: 'P2TR outputs, script trees, NUMS internal keys — Fabric contracts & HTLCs.',
    patterns: ['BIP341', 'BIP 341', 'Taproot', 'taproot', 'toHashTree', 'tapleafHash', 'NUMS'],
    expected: { core: 'strong', hub: 'strong', passport: 'absent', application: 'strong' }
  },
  {
    bip: 342,
    title: 'Validation of Taproot Scripts (Tapscript)',
    status: 'Deployed',
    layer: 'Consensus (soft fork)',
    adoption: 'universal',
    why: 'Script-path validation rules for Taproot leaves Fabric builds.',
    patterns: ['BIP342', 'Tapscript', 'tapscript', 'LEAF_VERSION_TAPSCRIPT'],
    expected: { core: 'strong', hub: 'dependent', passport: 'n/a', application: 'absent' }
  },
  {
    bip: 350,
    title: 'Bech32m format for v1+ witness addresses',
    status: 'Deployed',
    layer: 'Applications',
    adoption: 'universal',
    why: 'bc1p + Fabric id…/fa… bech32m strings.',
    patterns: ['BIP 350', 'BIP350', 'bech32m', 'BECH32M', '2bc830a3'],
    expected: { core: 'full', hub: 'strong', passport: 'full', application: 'strong' },
    notes: 'First-party codec lives in core/Passport. GoonCitizen consumes those ids (0 local hits → scanner Partial).'
  },
  {
    bip: 370,
    title: 'PSBT Version 2',
    status: 'Deployed',
    layer: 'Applications',
    adoption: 'common',
    why: 'PSBTv2 fields for advanced multisig / CoinJoin workflows.',
    patterns: ['BIP370', 'PSBT Version 2', 'PSBTv2', 'psbtVersion'],
    expected: { core: 'absent', hub: 'absent', passport: 'absent', application: 'absent' },
    notes: 'Stack uses bitcoinjs PSBT (v0/v2 capable via lib) without an explicit BIP370 compliance surface.'
  },
  {
    bip: 371,
    title: 'Taproot Fields for PSBT',
    status: 'Deployed',
    layer: 'Applications',
    adoption: 'common',
    why: 'PSBT taproot leaf/control-block fields for hardware + collaborative signing.',
    patterns: ['BIP371', 'taproot.*PSBT', 'tapLeafScript', 'tapMerkleRoot'],
    expected: { core: 'partial', hub: 'partial', passport: 'absent', application: 'absent' }
  },
  {
    bip: 380,
    title: 'Output Script Descriptors General Operation',
    status: 'Deployed',
    layer: 'Applications',
    adoption: 'common',
    why: 'Descriptor wallets are Bitcoin Core default; interoperability language for policies.',
    patterns: ['BIP380', 'importdescriptors', 'getdescriptorinfo', 'Output Script Descriptor', 'wsh('],
    expected: { core: 'partial', hub: 'dependent', passport: 'absent', application: 'absent' },
    notes: 'Bitcoin service / examples import descriptors via RPC; no first-party BIP380 parser.'
  },
  {
    bip: 386,
    title: 'tr() Output Script Descriptors',
    status: 'Deployed',
    layer: 'Applications',
    adoption: 'common',
    why: 'Taproot descriptor form used by Core descriptor wallets.',
    patterns: ['BIP386', 'tr(', 'tr()', 'taproot descriptor'],
    expected: { core: 'partial', hub: 'dependent', passport: 'absent', application: 'absent' }
  },
  {
    bip: 352,
    title: 'Silent Payments',
    status: 'Complete',
    layer: 'Applications',
    adoption: 'emerging',
    why: 'Rising wallet adoption for non-interactive private receives; inclusion as stretch goal.',
    patterns: ['BIP352', 'Silent Payment', 'silent payment', 'sp1q'],
    expected: { core: 'absent', hub: 'absent', passport: 'absent', application: 'absent' }
  },
  // --- Round-2 additions (product-adjacent specialized / Complete standards) ---
  {
    bip: 66,
    title: 'Strict DER signatures',
    status: 'Deployed',
    layer: 'Consensus (soft fork)',
    adoption: 'universal',
    why: 'Baseline ECDSA encoding consensus rule; wallets inherit via signing libraries.',
    patterns: ['BIP66', 'BIP-66', 'strict DER', 'isCanonicalDER', 'checkSignatureEncoding'],
    expected: { core: 'dependent', hub: 'dependent', passport: 'dependent', application: 'dependent' },
    notes: 'No first-party BIP66 module; ECDSA paths rely on bitcoinjs / bitcoind DER rules.'
  },
  {
    bip: 69,
    title: 'Lexicographical Indexing of Transaction Inputs and Outputs',
    status: 'Complete',
    layer: 'Applications',
    adoption: 'common',
    why: 'Deterministic vin/vout ordering used by privacy-preserving and collaborative tx builders.',
    patterns: ['BIP69', 'BIP-69', 'functions/bip69', 'lexicographical indexing', 'bip69', 'sortInputs'],
    expected: { core: 'full', hub: 'strong', passport: 'absent', application: 'absent' },
    notes: 'Core sortInputs/sortOutputs with official BIP-69 examples. Hub unsigned PSBTs (Bitcoin _buildPSBT, crowdfund payout, original Payjoin) sort before the first signature. Payjoin ACP does not reorder signed slots.'
  },
  {
    bip: 85,
    title: 'Deterministic Entropy From BIP32 Keychains',
    status: 'Deployed',
    layer: 'Applications',
    adoption: 'common',
    why: 'Derive app-specific entropy (extra mnemonics, Lightning seeds) from one BIP32 root.',
    patterns: ['BIP85', 'BIP-85', 'functions/bip85', 'deterministic entropy', "m/83696968'", 'deriveBip85Mnemonic'],
    expected: { core: 'full', hub: 'absent', passport: 'absent', application: 'absent' },
    notes: 'First-party HMAC entropy + BIP-39/WIF/XPRV/HEX applications against published BIP-85 vectors.'
  },
  {
    bip: 321,
    title: 'URI Scheme (Complete successor)',
    status: 'Complete',
    layer: 'Applications',
    adoption: 'common',
    why: 'BIP21 successor with richer query grammar; wallets increasingly advertise BIP321.',
    patterns: ['BIP321', 'BIP-321', 'bitcoin:', 'lightning=', 'pj='],
    expected: { core: 'partial', hub: 'partial', passport: 'absent', application: 'partial' },
    notes: 'Stack emits classic bitcoin: URIs (BIP21). Full BIP321 query grammar is not claimed.'
  },
  {
    bip: 322,
    title: 'Generic Signed Message Format',
    status: 'Complete',
    layer: 'Applications',
    adoption: 'common',
    why: 'Cross-wallet proof-of-funds / address ownership proofs beyond legacy signmessage.',
    patterns: ['BIP322', 'BIP-322', 'bip322', 'Generic Signed Message'],
    expected: { core: 'absent', hub: 'absent', passport: 'absent', application: 'absent' },
    notes: 'Fabric Message / Peer use BIP340 Schnorr with Fabric tags — not BIP322 address proofs.'
  },
  {
    bip: 48,
    title: 'Multi-Script Hierarchy for Multi-Sig Wallets',
    status: 'Deployed',
    layer: 'Applications',
    adoption: 'specialized',
    why: 'Standard purpose-48 paths for multisig script types; relevant to group / federation wallets.',
    patterns: ['BIP48', 'BIP-48', "m/48'", 'bitcoinBip48P2wshReceiveDerivationPath', 'multi-script hierarchy'],
    expected: { core: 'partial', hub: 'absent', passport: 'absent', application: 'absent' },
    notes: 'Named m/48\' p2sh-p2wsh / p2wsh path templates only. Group/federation vaults still sort keys without advertising BIP48 trees.'
  },
  {
    bip: 382,
    title: 'Segwit Output Script Descriptors',
    status: 'Deployed',
    layer: 'Applications',
    adoption: 'common',
    why: 'wpkh()/wsh() descriptor forms used by Core descriptor wallets and Fabric examples.',
    patterns: ['BIP382', 'wpkh(', 'wsh(', 'Segwit Output Script Descriptor'],
    expected: { core: 'partial', hub: 'partial', passport: 'partial', application: 'partial' },
    notes: 'Examples and RPC flows emit wpkh()/wsh() strings; no first-party BIP382 parser.'
  },
  {
    bip: 388,
    title: 'Wallet Policies for Descriptor Wallets',
    status: 'Complete',
    layer: 'Applications',
    adoption: 'specialized',
    why: 'Hardware-wallet / multisig policy language built on descriptors (Ledger, etc.).',
    patterns: ['BIP388', 'BIP-388', 'wallet policy', 'Wallet Policies'],
    expected: { core: 'absent', hub: 'absent', passport: 'absent', application: 'absent' }
  }
];

const EXCLUDED_NOTES = [
  'Process BIPs (1–3, 8–9) — governance, not stack compliance.',
  'Mining / getblocktemplate (22–23) — not a Fabric product surface.',
  'Closed / Rejected / OP_EVAL-era proposals — historical only.',
  'BIP-70…75 Payment Protocol — Deployed historically but industry-deprecated; Fabric uses BIP21 + Fabric Message / Lightning instead.',
  'Peer-service P2P BIPs (14, 31, 35, …) — bitcoind/CLN responsibility when Fabric embeds them.',
  'BIP-38 passphrase-encrypted WIF — uncommon in HD-mnemonic wallets; not scored.',
  'BIP-47 reusable payment codes — privacy sibling to BIP352; revisit with Silent Payments work.',
  'BIP-87/88/129/328/373/387 — remaining specialized multisig / MuSig2 / tapscript-descriptor items; revisit after BIP48/382/388 land or MuSig2 becomes product-critical.'
];

const LEVEL_RANK = {
  full: 5,
  strong: 4,
  partial: 3,
  dependent: 2,
  absent: 1,
  'n/a': 0
};

const LEVEL_LABEL = {
  full: 'Full',
  strong: 'Strong',
  partial: 'Partial',
  dependent: 'Dependent',
  absent: 'Absent',
  'n/a': 'N/A'
};

function resolveComponents () {
  const home = process.env.HOME || '';
  const candidates = {
    core: ROOT,
    hub: process.env.FABRIC_HUB || path.join(home, 'hub.fabric.pub'),
    passport: process.env.FABRIC_PASSPORT || path.join(home, 'fabric-browser-extension'),
    application: process.env.FABRIC_APPLICATION || path.join(home, 'star-citizen-live')
  };
  /** @type {Record<ComponentId, { id: ComponentId, label: string, root: string|null }>} */
  const out = {};
  for (const [id, root] of Object.entries(candidates)) {
    const resolved = root ? String(root) : '';
    out[/** @type {ComponentId} */ (id)] = {
      id: /** @type {ComponentId} */ (id),
      label: ({
        core: '@fabric/core',
        hub: 'hub.fabric.pub',
        passport: 'fabric-browser-extension',
        application: 'application'
      })[id],
      root: resolved && fs.existsSync(resolved) ? resolved : null
    };
  }
  return out;
}

const SKIP_DIR_NAMES = new Set([
  'node_modules', '.git', 'coverage', 'reports', 'dist', '_book', 'stores',
  'build', '.cursor', 'zip', 'assets'
]);

/** Skip generated / self-referential noise. */
function shouldSkipFile (relPath) {
  if (relPath === 'scripts/bip-compliance-report.js') return true;
  if (relPath.startsWith('coverage-') || relPath.includes('/coverage-')) return true;
  if (relPath.startsWith('reports/cov') || relPath.includes('/reports/')) return true;
  return false;
}

/** @param {string} s */
function escapeRegExp (s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Lightweight Node walk used when rg is unavailable or overflows.
 * @param {string} root
 * @param {RegExp} re
 * @param {number} [maxFiles=40]
 */
function nodeEvidenceHits (root, re, maxFiles = 40) {
  const samples = [];
  let hits = 0;
  /** @param {string} dir */
  function walk (dir) {
    if (hits >= 500) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_) {
      return;
    }
    for (const ent of entries) {
      if (hits >= 500) return;
      const name = ent.name;
      if (name.startsWith('.') && name !== '.github') continue;
      const full = path.join(dir, name);
      if (ent.isDirectory()) {
        if (SKIP_DIR_NAMES.has(name)) continue;
        if (name === 'libraries' || name === 'fomantic') continue;
        if (name.startsWith('coverage-') || name.startsWith('reports')) continue;
        walk(full);
        continue;
      }
      if (!/\.(js|ts|tsx|md|c|h|json)$/i.test(name)) continue;
      if (/\.min\.js$/i.test(name) || /\.map$/i.test(name)) continue;
      const rel = path.relative(root, full);
      if (shouldSkipFile(rel)) continue;
      let text;
      try {
        const st = fs.statSync(full);
        if (st.size > 1.5 * 1024 * 1024) continue;
        text = fs.readFileSync(full, 'utf8');
      } catch (_) {
        continue;
      }
      const m = text.match(re);
      if (!m) continue;
      hits += m.length;
      if (samples.length < maxFiles) samples.push(rel);
    }
  }
  walk(root);
  return { ok: true, hits, samples };
}

/**
 * Scan a component tree for evidence of BIP-related symbols.
 * Uses a portable Node walk (Cursor’s bundled `rg` is not reliable from spawnSync).
 * @param {string} root
 * @param {string[]} patterns
 */
function ripgrepHits (root, patterns) {
  if (!root || !patterns.length) return { ok: false, hits: 0, samples: [] };
  const re = new RegExp(patterns.map(escapeRegExp).join('|'), 'g');
  return nodeEvidenceHits(root, re);
}

/**
 * Curated `expected` is the baseline. Missing evidence demotes Full→Strong and
 * Strong→Partial one step; confirmed evidence keeps the curated level.
 * @param {ComplianceLevel} expected
 * @param {number} hits
 * @param {boolean} available
 * @param {string[]} [patterns]
 * @returns {ComplianceLevel}
 */
function scoreFromEvidence (expected, hits, available, patterns = []) {
  if (expected === 'n/a') return 'n/a';
  if (!available) return expected;
  if (expected === 'absent') {
    // Only promote when a BIP-numbered token (or equally specific marker) appears.
    const specific = patterns.some((p) => /^BIP\d+$/i.test(p) || /^m\/\d+/.test(p));
    return specific && hits >= 3 ? 'partial' : 'absent';
  }
  if (hits === 0) {
    if (expected === 'dependent') return 'dependent';
    if (expected === 'full') return 'strong';
    if (expected === 'strong') return 'partial';
    if (expected === 'partial') return 'absent';
    return expected;
  }
  return expected;
}

function isoNow () {
  return new Date().toISOString();
}

function ensureReportsDir () {
  if (!fs.existsSync(REPORTS)) fs.mkdirSync(REPORTS, { recursive: true });
}

function averageRank (levels) {
  const vals = levels.filter((l) => l !== 'n/a').map((l) => LEVEL_RANK[l]);
  if (!vals.length) return 0;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function buildReport () {
  const generatedAt = isoNow();
  const components = resolveComponents();
  const componentIds = /** @type {ComponentId[]} */ (['core', 'hub', 'passport', 'application']);

  const rows = EVALUATION_SUITE.map((entry) => {
    /** @type {Record<string, any>} */
    const byComponent = {};
    for (const id of componentIds) {
      const comp = components[id];
      const scan = comp.root
        ? ripgrepHits(comp.root, entry.patterns)
        : { ok: false, hits: 0, samples: [], missing: true };
      const level = scoreFromEvidence(entry.expected[id], scan.hits || 0, !!comp.root, entry.patterns);
      byComponent[id] = {
        level,
        expected: entry.expected[id],
        hits: scan.hits || 0,
        samples: scan.samples || [],
        available: !!comp.root,
        error: scan.error || null
      };
    }
    return {
      bip: entry.bip,
      title: entry.title,
      status: entry.status,
      layer: entry.layer,
      adoption: entry.adoption,
      why: entry.why,
      notes: entry.notes || null,
      patterns: entry.patterns,
      components: byComponent,
      stackScore: Number(averageRank(componentIds.map((id) => byComponent[id].level)).toFixed(2))
    };
  });

  const byAdoption = { universal: [], common: [], specialized: [], emerging: [] };
  for (const row of rows) byAdoption[row.adoption].push(row);

  const summary = {
    suiteSize: rows.length,
    catalogNote: 'Public BIPs indexed from bitcoin/bips (~210). Suite selects Deployed/Complete wallet + consensus standards with broad industry adoption, plus Fabric-touched emerging items (BIP77, BIP352).',
    components: Object.fromEntries(
      componentIds.map((id) => [id, {
        label: components[id].label,
        root: components[id].root,
        available: !!components[id].root
      }])
    ),
    levelCounts: {},
    adoptionCounts: {
      universal: byAdoption.universal.length,
      common: byAdoption.common.length,
      specialized: byAdoption.specialized.length,
      emerging: byAdoption.emerging.length
    },
    meanStackScore: Number(
      (rows.reduce((s, r) => s + r.stackScore, 0) / Math.max(1, rows.length)).toFixed(2)
    ),
    excluded: EXCLUDED_NOTES
  };

  for (const id of componentIds) {
    const counts = { full: 0, strong: 0, partial: 0, dependent: 0, absent: 0, 'n/a': 0 };
    for (const row of rows) counts[row.components[id].level]++;
    summary.levelCounts[id] = counts;
  }

  return {
    meta: {
      title: 'Fabric Stack BIP Compliance Report',
      generatedAt,
      generator: 'scripts/bip-compliance-report.js',
      methodology: [
        'Enumerate public BIPs (bitcoin/bips README).',
        'Retain Deployed/Complete Application + consensus soft-fork standards commonly required for wallet/payment interop.',
        'Drop Process, mining-only, Closed, and industry-deprecated BIP-70 suite from the scored set.',
        'Grade each remaining BIP across Fabric components at degrees: Full / Strong / Partial / Dependent / Absent / N/A.',
        'Re-scan sibling trees with portable filesystem evidence patterns; demote expected levels when evidence is weak or missing.'
      ],
      complianceDegrees: {
        full: 'First-party implementation + vector/unit coverage aligned to the BIP.',
        strong: 'Production use with tests; may lean on vetted libraries while exposing a clear Fabric API.',
        partial: 'Subset, Fabric-adapted semantics, or incomplete path coverage.',
        dependent: 'Correct behavior only via bitcoind / CLN / bitcoinjs without a Fabric-owned compliance surface.',
        absent: 'No meaningful implementation found.',
        'n/a': 'Outside this component’s role.'
      }
    },
    summary,
    suite: rows
  };
}

function markdownFromReport (report) {
  const lines = [];
  lines.push(`# ${report.meta.title}`);
  lines.push('');
  lines.push(`Generated: \`${report.meta.generatedAt}\``);
  lines.push('');
  lines.push('Regenerate: `npm run report:bip-compliance`');
  lines.push('');
  lines.push('## Methodology');
  for (let i = 0; i < report.meta.methodology.length; i++) {
    lines.push(`${i + 1}. ${report.meta.methodology[i]}`);
  }
  lines.push('');
  lines.push('## Compliance degrees');
  for (const [k, v] of Object.entries(report.meta.complianceDegrees)) {
    lines.push(`- **${LEVEL_LABEL[k] || k}** — ${v}`);
  }
  lines.push('');
  lines.push('## Component roots');
  for (const [id, c] of Object.entries(report.summary.components)) {
    lines.push(`- **${c.label}** (\`${id}\`): ${c.available ? c.root : '_not found_'}`);
  }
  lines.push('');
  lines.push(`## Summary`);
  lines.push('');
  lines.push(`- Suite size: **${report.summary.suiteSize}** BIPs (from ~210 public proposals)`);
  lines.push(`- Mean stack score (1=absent … 5=full, N/A excluded): **${report.summary.meanStackScore}**`);
  lines.push(`- Adoption mix: universal ${report.summary.adoptionCounts.universal}, common ${report.summary.adoptionCounts.common}, specialized ${report.summary.adoptionCounts.specialized}, emerging ${report.summary.adoptionCounts.emerging}`);
  lines.push('');
  lines.push('| Component | Full | Strong | Partial | Dependent | Absent | N/A |');
  lines.push('|---|---:|---:|---:|---:|---:|---:|');
  for (const [id, counts] of Object.entries(report.summary.levelCounts)) {
    lines.push(`| ${report.summary.components[id].label} | ${counts.full} | ${counts.strong} | ${counts.partial} | ${counts.dependent} | ${counts.absent} | ${counts['n/a']} |`);
  }
  lines.push('');
  lines.push('## Evaluation suite');
  lines.push('');
  lines.push('| BIP | Adoption | Title | Core | Hub | Passport | Application | Stack |');
  lines.push('|---:|---|---|---|---|---|---|---:|');
  for (const row of report.suite) {
    lines.push(
      `| ${row.bip} | ${row.adoption} | ${row.title.replace(/\|/g, '/')} | ` +
      `${LEVEL_LABEL[row.components.core.level]} | ${LEVEL_LABEL[row.components.hub.level]} | ` +
      `${LEVEL_LABEL[row.components.passport.level]} | ${LEVEL_LABEL[row.components.application.level]} | ${row.stackScore} |`
    );
  }
  lines.push('');
  lines.push('## Per-BIP detail');
  for (const row of report.suite) {
    lines.push('');
    lines.push(`### BIP-${row.bip} — ${row.title}`);
    lines.push('');
    lines.push(`- Status: ${row.status}`);
    lines.push(`- Layer: ${row.layer}`);
    lines.push(`- Why selected: ${row.why}`);
    if (row.notes) lines.push(`- Notes: ${row.notes}`);
    lines.push('- Evidence hits: ' +
      ['core', 'hub', 'passport', 'application']
        .map((id) => `${id}=${row.components[id].hits}`)
        .join(', '));
  }
  lines.push('');
  lines.push('## Explicitly not scored');
  for (const note of report.summary.excluded) lines.push(`- ${note}`);
  lines.push('');
  lines.push('## Source');
  lines.push('');
  lines.push('- Catalog: https://github.com/bitcoin/bips');
  lines.push('- Generator: `scripts/bip-compliance-report.js`');
  lines.push('');
  return lines.join('\n');
}

function main () {
  ensureReportsDir();
  const report = buildReport();
  const jsonPath = path.join(REPORTS, 'bip-compliance.json');
  const mdPath = path.join(REPORTS, 'bip-compliance.md');
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2) + '\n');
  fs.writeFileSync(mdPath, markdownFromReport(report));
  console.log(`[bip-compliance] wrote ${path.relative(ROOT, jsonPath)}`);
  console.log(`[bip-compliance] wrote ${path.relative(ROOT, mdPath)}`);
  console.log(`[bip-compliance] suite=${report.summary.suiteSize} meanStackScore=${report.summary.meanStackScore}`);
  for (const [id, counts] of Object.entries(report.summary.levelCounts)) {
    console.log(
      `[bip-compliance] ${id}: full=${counts.full} strong=${counts.strong} partial=${counts.partial} ` +
      `dependent=${counts.dependent} absent=${counts.absent} n/a=${counts['n/a']}`
    );
  }
}

if (require.main === module) {
  main();
}
