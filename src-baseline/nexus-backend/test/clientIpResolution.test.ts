// F06-a: pure resolution rules for the client identity behind (optional) trusted proxies.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTrustedPeers, resolveClientIp } from '../src/gateway/middleware/clientIp.js';

const peers = (s: string) => parseTrustedPeers(s);

test('no trusted peers (default) => forwarded header ignored, socket address returned', () => {
  assert.equal(resolveClientIp('198.51.100.9', '1.2.3.4', peers('')), '198.51.100.9');
});
test('untrusted peer cannot spoof even when other peers are trusted', () => {
  assert.equal(resolveClientIp('198.51.100.9', '1.2.3.4', peers('10.0.0.1')), '198.51.100.9');
});
test('trusted peer => rightmost untrusted hop in the chain is the client (leftmost entry is attacker-controlled)', () => {
  // client spoofs "6.6.6.6", real client 203.0.113.5 was appended by the proxy; 10.0.0.2 is a second trusted hop
  assert.equal(resolveClientIp('10.0.0.1', '6.6.6.6, 203.0.113.5, 10.0.0.2', peers('10.0.0.1,10.0.0.2')), '203.0.113.5');
});
test('trusted peer + all hops trusted => leftmost', () => {
  assert.equal(resolveClientIp('10.0.0.1', '10.0.0.3, 10.0.0.2', peers('10.0.0.0/24')), '10.0.0.3');
});
test('trusted peer without header => peer address', () => {
  assert.equal(resolveClientIp('10.0.0.1', undefined, peers('10.0.0.1')), '10.0.0.1');
});
test('malformed hop => fail closed to the proxy address (never an attacker string)', () => {
  assert.equal(resolveClientIp('10.0.0.1', 'not-an-ip, 203.0.113.5', peers('10.0.0.1')), '10.0.0.1');
  assert.equal(resolveClientIp('10.0.0.1', '203.0.113.5, <script>', peers('10.0.0.1')), '10.0.0.1');
});
test('IPv4-mapped IPv6 peer matches an IPv4 entry; CIDR works', () => {
  assert.equal(resolveClientIp('::ffff:10.0.0.7', '203.0.113.5', peers('10.0.0.0/24')), '203.0.113.5');
  assert.equal(resolveClientIp('10.0.1.7', '203.0.113.5', peers('10.0.0.0/24')), '10.0.1.7');
});
test('invalid / wildcard config entries are ignored (fail closed): "true", "*", garbage never trust everyone', () => {
  for (const bad of ['true', '*', '1', 'yes', '0.0.0.0/0x', '300.1.1.1', '10.0.0.0/33']) {
    assert.equal(resolveClientIp('198.51.100.9', '1.2.3.4', peers(bad)), '198.51.100.9', bad);
  }
});
test('IPv6 forwarded client accepted when valid', () => {
  assert.equal(resolveClientIp('10.0.0.1', '2001:db8::1', peers('10.0.0.1')), '2001:db8::1');
});
