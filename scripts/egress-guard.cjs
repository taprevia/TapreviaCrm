/**
 * P3.6 local egress guard.
 *
 * Load with: NODE_OPTIONS="--require /abs/path/scripts/egress-guard.cjs"
 *
 * Denies every outbound network connection except loopback/Unix sockets. This
 * is a process-level restriction for the local audit server: it covers
 * node:http/https, global fetch (undici), Mongo drivers and any library that
 * ultimately uses net.Socket.connect / dns.lookup. Browser traffic is handled
 * separately by the CDP interceptor.
 *
 * It is intentionally test-only and MUST NOT be loaded in production.
 */
'use strict';

const net = require('net');
const dns = require('dns');
const dgram = require('dgram');

const ALLOWED = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0', '::']);
const LOG_PREFIX = '[egress-guard]';

function allowedHost(host) {
  if (!host) return true; // default host is loopback for net.connect
  const value = String(host).trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (ALLOWED.has(value)) return true;
  if (value.endsWith('.localhost')) return true;
  return false;
}

function block(target, kind) {
  const message = `${LOG_PREFIX} BLOCKED ${kind} ${target}`;
  console.error(message);
  if (process.env.EGRESS_GUARD_LOG) {
    try {
      require('fs').appendFileSync(process.env.EGRESS_GUARD_LOG, `${new Date().toISOString()} ${message}\n`);
    } catch {
      /* logging must never affect the audit */
    }
  }
  const error = new Error(`EGRESS_BLOCKED: ${target}`);
  error.code = 'EGRESS_BLOCKED';
  return error;
}

if (!global.__p36EgressGuardInstalled) {
  global.__p36EgressGuardInstalled = true;

  const originalConnect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function guardedConnect(...args) {
    let host = null;
    let target = '';
    const first = args[0];
    if (first && typeof first === 'object' && !Array.isArray(first)) {
      if (first.path) return originalConnect.apply(this, args); // Unix socket
      host = first.host || first.hostname || null;
      target = `${host || 'loopback'}:${first.port || ''}`;
    } else if (typeof first === 'string' && !/^\d+$/.test(first)) {
      // net.connect('/tmp/socket') — Unix path
      return originalConnect.apply(this, args);
    } else {
      host = typeof args[1] === 'string' ? args[1] : null;
      target = `${host || 'loopback'}:${first || ''}`;
    }
    if (host && !allowedHost(host)) {
      const error = block(target, 'socket');
      process.nextTick(() => this.destroy(error));
      return this;
    }
    return originalConnect.apply(this, args);
  };

  const originalLookup = dns.lookup;
  dns.lookup = function guardedLookup(hostname, options, callback) {
    const cb = typeof options === 'function' ? options : callback;
    if (!allowedHost(hostname)) {
      const error = block(String(hostname), 'dns');
      if (typeof cb === 'function') return process.nextTick(() => cb(error));
      throw error;
    }
    return originalLookup.call(this, hostname, options, callback);
  };

  if (dns.promises && dns.promises.lookup) {
    const originalPromiseLookup = dns.promises.lookup;
    dns.promises.lookup = async function guardedPromiseLookup(hostname, options) {
      if (!allowedHost(hostname)) throw block(String(hostname), 'dns');
      return originalPromiseLookup.call(this, hostname, options);
    };
  }

  const originalSend = dgram.Socket.prototype.send;
  dgram.Socket.prototype.send = function guardedSend(...args) {
    const host = typeof args[4] === 'string' ? args[4] : null;
    if (host && !allowedHost(host)) {
      const error = block(`${host}:${args[1] || ''}`, 'udp');
      process.nextTick(() => this.emit('error', error));
      return;
    }
    return originalSend.apply(this, args);
  };

  console.log(`${LOG_PREFIX} active — loopback only`);
}
