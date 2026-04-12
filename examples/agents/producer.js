'use strict';

function producerConfigFromEnv (numberOfCores) {
  const producerIntervalEnv = Number(process.env.FABRIC_AGENTS_PRODUCER_INTERVAL_MS);
  const producerBatchEnv = Number(process.env.FABRIC_AGENTS_PRODUCER_BATCH_SIZE);
  const producerTargetEnv = Number(process.env.FABRIC_AGENTS_PRODUCER_TARGET);
  const fastBidEveryEnv = Number(process.env.FABRIC_AGENTS_FAST_BID_EVERY);
  const fastBidAmountEnv = Number(process.env.FABRIC_AGENTS_FAST_BID_AMOUNT);

  return {
    producerIntervalMs: (Number.isFinite(producerIntervalEnv) && producerIntervalEnv > 0)
      ? Math.floor(producerIntervalEnv)
      : 100,
    producerBatchSize: (Number.isFinite(producerBatchEnv) && producerBatchEnv > 0)
      ? Math.floor(producerBatchEnv)
      : Math.max(4, numberOfCores),
    producerTarget: (Number.isFinite(producerTargetEnv) && producerTargetEnv > 0)
      ? Math.floor(producerTargetEnv)
      : 1000,
    fastBidEvery: (Number.isFinite(fastBidEveryEnv) && fastBidEveryEnv > 0)
      ? Math.floor(fastBidEveryEnv)
      : 25,
    fastBidAmount: (Number.isFinite(fastBidAmountEnv) && fastBidAmountEnv >= 1)
      ? Math.floor(fastBidAmountEnv)
      : 3
  };
}

function requiredBidFromQueueError (error) {
  const message = String((error && error.message) || error || '');
  const match = message.match(/Pay\s+(\d+)\s+satoshi/i);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
}

function scheduleAgentProducers ({
  master,
  lightning,
  aliceLightning,
  getLightningStatusSnapshot,
  statusJsonEnabled,
  config
}) {
  let producerSequence = 0;
  let completed = false;
  let producing = false;
  const metrics = {
    target: config.producerTarget,
    submitted: 0,
    accepted: 0,
    queueFull: 0,
    rebidSuccess: 0,
    rebidFailure: 0,
    maxBid: 0
  };
  let resolveDone;
  const done = new Promise((resolve) => {
    resolveDone = resolve;
  });

  const trySubmitWork = (jobIndex) => {
    const occasionalFastLane = config.fastBidEvery > 0 && (jobIndex % config.fastBidEvery === 0);
    const initialBid = occasionalFastLane ? config.fastBidAmount : 0;
    metrics.submitted++;

    try {
      master.requestWork({ index: `work-${jobIndex}` }, initialBid);
      metrics.accepted++;
      if (initialBid > metrics.maxBid) metrics.maxBid = initialBid;
      return true;
    } catch (error) {
      const requiredBid = requiredBidFromQueueError(error);
      if (requiredBid == null) return false;

      metrics.queueFull++;
      const escalatedBid = Math.max(requiredBid, initialBid + 1);
      try {
        master.requestWork({ index: `work-${jobIndex}` }, escalatedBid);
        metrics.accepted++;
        metrics.rebidSuccess++;
        if (escalatedBid > metrics.maxBid) metrics.maxBid = escalatedBid;
        return true;
      } catch {
        metrics.rebidFailure++;
        return false;
      }
    }
  };

  const producerTimer = setInterval(() => {
    if (completed || producing) return;
    producing = true;
    try {
      for (let i = 0; i < config.producerBatchSize; i++) {
        if (metrics.accepted >= metrics.target) break;
        const submitted = trySubmitWork(producerSequence++);
        if (!submitted) break;
      }
    } finally {
      producing = false;
    }

    if (metrics.accepted >= metrics.target) {
      completed = true;
      clearInterval(producerTimer);
    }
  }, config.producerIntervalMs);

  const statusTimer = setInterval(() => {
    Promise.resolve().then(async () => {
      let snapshot = {
        masterFunds: {},
        aliceFunds: {},
        masterChannels: [],
        aliceChannels: [],
        updatedAt: null
      };
      if (lightning && aliceLightning) {
        snapshot = await getLightningStatusSnapshot(lightning, aliceLightning);
      }
      master.setExternalStatus(snapshot);

      const status = master.status();
      const aliceChannels = Array.isArray(snapshot.aliceChannels) ? snapshot.aliceChannels : [];
      const masterChannels = Array.isArray(snapshot.masterChannels) ? snapshot.masterChannels : [];
      const aliceFunds = snapshot.aliceFunds || {};
      const masterFunds = snapshot.masterFunds || {};
      const workerSummary = status.workers.map((worker) => {
        const state = worker.state || {};
        return `w${worker.index}:done=${worker.processed},err=${worker.errors},earned=${worker.earnedSats || 0}sats,paid=${worker.paidJobs || 0},${worker.busy ? 'busy' : 'idle'},state.jobs=${state.queueProcessed || 0},state.depth=${state.depth || 0},state.last=${state.lastPayload || '-'}`;
      }).join(' | ');

      if (statusJsonEnabled) {
        console.log(JSON.stringify({
          type: 'agents_status',
          timestamp: new Date().toISOString(),
          queueDepth: status.queueDepth,
          completed: status.completed,
          failed: status.failed,
          paymentCreditSats: status.paymentCreditSats,
          paidJobsCompleted: status.paidJobsCompleted,
          paidJobsFailed: status.paidJobsFailed,
          totalPaidSatsEarned: status.totalPaidSatsEarned,
          processed: status.processed,
          workersBusy: status.workersBusy,
          workersTotal: status.workersTotal,
          stateDepth: status.stateDepth,
          stateTip: status.stateTip,
          historyRoot: status.historyRoot,
          lightning: {
            masterChannels: masterChannels.length,
            aliceChannels: aliceChannels.length,
            masterFunds: masterFunds.total_msat || masterFunds.total || null,
            aliceFunds: aliceFunds.total_msat || aliceFunds.total || null
          }
        }));
      }

      console.log(
        `[MASTER] [STATUS] queue=${status.queueDepth} completed=${status.completed} failed=${status.failed} processed=${status.processed} paid_done=${status.paidJobsCompleted} paid_fail=${status.paidJobsFailed} earned=${status.totalPaidSatsEarned}sats credit=${status.paymentCreditSats}sats busy=${status.workersBusy}/${status.workersTotal} ${workerSummary}`
      );

      if (lightning && aliceLightning) {
        console.log(
          `[ALICE] [STATUS:LIGHTNING] channels=${aliceChannels.length} funds=${aliceFunds.total_msat || aliceFunds.total || '-'}`
        );
        console.log(
          `[MASTER] [STATUS:LIGHTNING] channels=${masterChannels.length} funds=${masterFunds.total_msat || masterFunds.total || '-'}`
        );
      }

      console.log(
        `[MASTER] [MERKLE] depth=${status.stateDepth} root=${status.historyRoot || '-'} tip=${status.stateTip || '-'} parent=${status.stateParent || '-'}`
      );

      console.log(
        `[MASTER] [BIDDING] accepted=${metrics.accepted}/${metrics.target} submitted=${metrics.submitted} queue_full=${metrics.queueFull} rebid_ok=${metrics.rebidSuccess} rebid_fail=${metrics.rebidFailure} max_bid=${metrics.maxBid}`
      );

      if (completed && status.queueDepth === 0 && status.workersBusy === 0) {
        clearInterval(statusTimer);
        resolveDone({ ...metrics });
      }
    }).catch((error) => {
      console.warn('[STATUS]', 'Status tick failed:', error.message);
    });
  }, 5000);

  return { producerTimer, statusTimer, done };
}

module.exports = {
  producerConfigFromEnv,
  requiredBidFromQueueError,
  scheduleAgentProducers
};
