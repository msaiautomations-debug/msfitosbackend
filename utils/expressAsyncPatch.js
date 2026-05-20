function wrapHandler(handler) {
  if (typeof handler !== 'function') return handler;
  if (handler.__msfitosAsyncWrapped) return handler;

  const wrapped =
    handler.length === 4
      ? function wrappedErrorHandler(err, req, res, next) {
          try {
            const result = handler(err, req, res, next);
            if (result && typeof result.then === 'function') {
              result.catch(next);
            }
          } catch (caughtError) {
            next(caughtError);
          }
        }
      : function wrappedHandler(req, res, next) {
          try {
            const result = handler(req, res, next);
            if (result && typeof result.then === 'function') {
              result.catch(next);
            }
          } catch (caughtError) {
            next(caughtError);
          }
        };

  Object.defineProperty(wrapped, '__msfitosAsyncWrapped', {
    value: true,
    enumerable: false,
  });

  return wrapped;
}

function wrapHandlers(args) {
  return args.map((arg) => (Array.isArray(arg) ? wrapHandlers(arg) : wrapHandler(arg)));
}

function patchExpressAsyncHandlers(express) {
  const routerProto = Object.getPrototypeOf(express.Router());
  const methods = ['use', 'all', 'get', 'post', 'put', 'patch', 'delete', 'options', 'head'];

  methods.forEach((method) => {
    const original = routerProto[method];
    if (typeof original !== 'function' || original.__msfitosAsyncPatched) return;

    const patched = function patchedRouterMethod(...args) {
      return original.apply(this, wrapHandlers(args));
    };

    Object.defineProperty(patched, '__msfitosAsyncPatched', {
      value: true,
      enumerable: false,
    });

    routerProto[method] = patched;
  });
}

module.exports = { patchExpressAsyncHandlers };
