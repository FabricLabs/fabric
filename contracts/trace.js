module.exports = function OP_TRACE (obj = {}) {
  Error.captureStackTrace(obj, OP_TRACE);
  return `@\n${obj.stack.split('\n').slice(1).join('\n')}`;
};
