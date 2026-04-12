'use strict';

const crypto = require('crypto');
const Entity = require('../../types/entity');

function defaultWork (payload = {}) {
  this.queueProcessed = (this.queueProcessed || 0) + 1;
  this.lastPayload = payload.index;
  const workSha256Iters = (Number.isFinite(Number(this.workSha256Iters)) && Number(this.workSha256Iters) > 0)
    ? Math.min(Math.floor(Number(this.workSha256Iters)), 2_000_000)
    : 0;
  const workDelayMs = (Number.isFinite(Number(this.workDelayMs)) && Number(this.workDelayMs) >= 0)
    ? Number(this.workDelayMs)
    : 0;

  console.debug(`[WORKER:INNER] Worker #${this.workerIndex} Starting work...`, payload.index);
  return new Promise((resolve) => {
    if (workSha256Iters > 0) {
      let buf = crypto.randomBytes(32);
      for (let i = 0; i < workSha256Iters; i++) {
        buf = crypto.createHash('sha256').update(buf).update(Buffer.from(String(i % 65536))).digest();
      }
      this.lastWorkDigest = buf.toString('hex', 0, 8);
    }
    const newState = { ...payload.state, workerIndex: this.workerIndex, incrementor: this.queueProcessed };
    const entityID = `${newState.workerIndex}:${newState.incrementor}:${payload.index}`;
    setTimeout(() => {
      console.log('[WORKER:INNER] Work complete:', payload);
      resolve({
        depth: payload.state.depth,
        parent: payload.state.parent,
        output: payload.index,
        entity: entityID,
        state: { ...newState, id: entityID }
      });
    }, workDelayMs);
  });
}

function cloneState (value) {
  try {
    return JSON.parse(JSON.stringify(value || {}));
  } catch {
    return {};
  }
}

function compileWorkerFunction (source) {
  // Dynamic code compilation is intentionally disabled for security.
  // Workers execute the built-in `defaultWork` implementation.
  void source;
  return null;
}

function computeWorkerStateID (state = {}) {
  return new Entity({
    workerIndex: state.workerIndex,
    processed: state.processed,
    depth: state.depth,
    errors: state.errors,
    lastJobID: state.lastJobID,
    queueProcessed: state.queueProcessed,
    lastPayload: state.lastPayload,
    parentStateID: state.parentStateID
  }).id;
}

function runWorkerLoop ({ parentPort, workerData, processObj }) {
  const run = compileWorkerFunction(workerData && workerData.functionSource) || defaultWork;
  const boundState = Object.assign({
    workerIndex: workerData && workerData.workerIndex,
    processed: 0,
    depth: 0,
    errors: 0,
    lastJobID: null,
    parentStateID: null,
    stateID: null,
    workSha256Iters: Number(workerData && workerData.workSha256Iters) || 0,
    workDelayMs: Number(workerData && workerData.workDelayMs) || 0
  }, cloneState(workerData && workerData.initialState));

  boundState.stateID = computeWorkerStateID(boundState);
  if (!parentPort) return;

  parentPort.on('message', async (message) => {
    if (!message) return;
    if (message.type === 'shutdown') {
      processObj.exit(0);
      return;
    }
    if (message.type !== 'start') return;

    try {
      boundState.lastJobID = message.id || null;
      boundState.parentStateID = boundState.stateID || message.parentStateID || boundState.parentStateID || null;
      boundState.parent = boundState.parentStateID;
      boundState.depth = (boundState.depth || 0) + 1;
      if (typeof run === 'function') {
        const result = await run.call(boundState, Object.assign({}, message.payload, {
          state: boundState
        }));

        if (result && typeof result === 'object' && result.state && typeof result.state === 'object') {
          Object.assign(boundState, result.state);
        }
      }

      boundState.processed++;
      boundState.stateID = computeWorkerStateID(boundState);

      parentPort.postMessage({
        type: 'done',
        id: message.id,
        pid: processObj.pid,
        state: cloneState(boundState)
      });
    } catch (error) {
      boundState.errors++;
      parentPort.postMessage({
        type: 'error',
        id: message.id,
        error: error.message,
        state: cloneState(boundState)
      });
    }
  });
}

module.exports = {
  defaultWork,
  cloneState,
  runWorkerLoop
};
