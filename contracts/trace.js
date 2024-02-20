module.exports = function OP_TRACE (obj = {}) {
  // console.log('[TRACE] Starting trace...');
  // console.log('[TRACE] Runtime:', this);
  // console.log('[TRACE] obj:', obj);
  Error.captureStackTrace(obj, OP_TRACE);
  return `@\n${obj.stack.split('\n').slice(1).join('\n')}`;
};
