const dns = require('dns');
const net = require('net');

let configured = false;

function isRawIpv6Host(hostname) {
  if (!hostname) return false;
  const normalized = String(hostname).trim().replace(/^\[|\]$/g, '');
  return net.isIP(normalized) === 6;
}

function assertNoRawIpv6Host(label, hostname) {
  if (isRawIpv6Host(hostname)) {
    throw new Error(`${label} must use a hostname or IPv4 address. Raw IPv6 addresses are not allowed.`);
  }
}

function ipv4OnlyLookup(hostname, options, callback) {
  const normalizedOptions = typeof options === 'function' ? {} : { ...(options || {}) };
  const done = typeof options === 'function' ? options : callback;

  if (!hostname) {
    done(new Error('Missing hostname for DNS lookup'));
    return;
  }

  if (isRawIpv6Host(hostname)) {
    done(new Error(`IPv6 host "${hostname}" is not allowed in this environment`));
    return;
  }

  if (net.isIP(hostname) === 4) {
    done(null, hostname, 4);
    return;
  }

  dns.resolve4(hostname, (resolveErr, addresses) => {
    if (!resolveErr && Array.isArray(addresses) && addresses.length > 0) {
      done(null, addresses[0], 4);
      return;
    }

    dns.lookup(hostname, { ...normalizedOptions, family: 4, hints: dns.ADDRCONFIG }, (lookupErr, address) => {
      if (!lookupErr && address) {
        done(null, address, 4);
        return;
      }

      done(lookupErr || resolveErr || new Error(`Unable to resolve IPv4 address for ${hostname}`));
    });
  });
}

function validateConnectionEnvironment() {
  assertNoRawIpv6Host('EMAIL_HOST', process.env.EMAIL_HOST);
}

function configureIpv4OnlyNetworking() {
  if (configured) return;
  configured = true;

  if (typeof dns.setDefaultResultOrder === 'function') {
    dns.setDefaultResultOrder('ipv4first');
  }

  const originalLookup = dns.lookup.bind(dns);
  dns.lookup = function patchedLookup(hostname, options, callback) {
    if (typeof options === 'function') {
      return ipv4OnlyLookup(hostname, options);
    }

    const normalizedOptions = { ...(options || {}) };
    if (!('family' in normalizedOptions) || normalizedOptions.family !== 4) {
      normalizedOptions.family = 4;
    }

    return originalLookup(hostname, normalizedOptions, callback);
  };

  validateConnectionEnvironment();
}

module.exports = {
  assertNoRawIpv6Host,
  configureIpv4OnlyNetworking,
  ipv4OnlyLookup,
  isRawIpv6Host,
};
