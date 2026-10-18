import { describe, it, expect, afterAll } from 'vitest';
import net from 'node:net';
import http from 'node:http';
import {
  createForbiddenBlockList,
  startEgressProxy,
  parseHostAndPort,
  type EgressProxy,
} from '../../src/capture/egressProxy.js';

describe('createForbiddenBlockList', () => {
  const { isForbidden } = createForbiddenBlockList();

  it('blocks all required IPv4 private, loopback, link-local, and special ranges', () => {
    expect(isForbidden('0.0.0.1')).toBe(true);
    expect(isForbidden('10.0.0.1')).toBe(true);
    expect(isForbidden('100.64.1.1')).toBe(true);
    expect(isForbidden('127.0.0.1')).toBe(true);
    expect(isForbidden('169.254.169.254')).toBe(true);
    expect(isForbidden('172.16.0.1')).toBe(true);
    expect(isForbidden('172.31.255.255')).toBe(true);
    expect(isForbidden('192.0.0.1')).toBe(true);
    expect(isForbidden('192.168.1.1')).toBe(true);
    expect(isForbidden('198.18.0.1')).toBe(true);
    expect(isForbidden('224.0.0.1')).toBe(true);
    expect(isForbidden('240.0.0.1')).toBe(true);
  });

  it('blocks all required IPv6 ranges', () => {
    expect(isForbidden('::', 6)).toBe(true);
    expect(isForbidden('::1', 6)).toBe(true);
    expect(isForbidden('fc00::1', 6)).toBe(true);
    expect(isForbidden('fd12:3456:789a::1', 6)).toBe(true);
    expect(isForbidden('fe80::1', 6)).toBe(true);
    expect(isForbidden('ff02::1', 6)).toBe(true);
    expect(isForbidden('64:ff9b::192.168.1.1', 6)).toBe(true);
    expect(isForbidden('2002:c0a8:101::', 6)).toBe(true);
  });

  it('blocks IPv4-mapped IPv6 addresses (both dotted and hex notation)', () => {
    expect(isForbidden('::ffff:127.0.0.1', 6)).toBe(true);
    expect(isForbidden('::ffff:7f00:1', 6)).toBe(true);
    expect(isForbidden('::ffff:7f00:0001', 6)).toBe(true);
    expect(isForbidden('::ffff:10.0.0.1', 6)).toBe(true);
    expect(isForbidden('::ffff:169.254.169.254', 6)).toBe(true);
    expect(isForbidden('::ffff:100.64.1.1', 6)).toBe(true);
    expect(isForbidden('::ffff:192.168.0.1', 6)).toBe(true);
    expect(isForbidden('0:0:0:0:0:ffff:127.0.0.1', 6)).toBe(true);
  });

  it('allows public IPv4 and IPv6 addresses', () => {
    expect(isForbidden('93.184.216.34')).toBe(false); // example.com
    expect(isForbidden('8.8.8.8')).toBe(false); // Google DNS
    expect(isForbidden('1.1.1.1')).toBe(false); // Cloudflare DNS
    expect(isForbidden('2606:2800:220:1:248:1893:25c8:1946', 6)).toBe(false);
  });
});

describe('parseHostAndPort', () => {
  it('parses host and port from various URL formats', () => {
    expect(parseHostAndPort('example.com:443', 443)).toEqual({ hostname: 'example.com', port: 443 });
    expect(parseHostAndPort('[::1]:443', 443)).toEqual({ hostname: '::1', port: 443 });
    expect(parseHostAndPort('http://example.com/foo', 80)).toEqual({ hostname: 'example.com', port: 80 });
    expect(parseHostAndPort('http://example.com:8080/foo', 80)).toEqual({ hostname: 'example.com', port: 8080 });
  });
});

describe('startEgressProxy', () => {
  const openProxies: EgressProxy[] = [];

  afterAll(async () => {
    for (const p of openProxies) {
      await p.close();
    }
  });

  it('rejects CONNECT to a non-80/443 port on a public host', async () => {
    const proxy = await startEgressProxy();
    openProxies.push(proxy);

    const res = await new Promise<string>((resolve) => {
      const client = net.connect({ host: '127.0.0.1', port: proxy.port }, () => {
        client.write('CONNECT example.com:8080 HTTP/1.1\r\nHost: example.com:8080\r\n\r\n');
      });
      client.on('data', (data) => {
        resolve(data.toString());
        client.destroy();
      });
    });

    expect(res).toContain('HTTP/1.1 403 Forbidden');
  });

  it('rejects CONNECT to a hostname that resolves to a private IP via injected resolver', async () => {
    const proxy = await startEgressProxy({
      resolver: async () => [{ address: '10.0.0.1', family: 4 }],
    });
    openProxies.push(proxy);

    const res = await new Promise<string>((resolve) => {
      const client = net.connect({ host: '127.0.0.1', port: proxy.port }, () => {
        client.write('CONNECT evil.private.domain:443 HTTP/1.1\r\nHost: evil.private.domain:443\r\n\r\n');
      });
      client.on('data', (data) => {
        resolve(data.toString());
        client.destroy();
      });
    });

    expect(res).toContain('HTTP/1.1 403 Forbidden');
  });

  it('prevents DNS rebinding by connecting directly to the validated IP', async () => {
    let callCount = 0;
    // On call 1 (proxy validation), return a fake public IP 198.51.100.1 (TEST-NET-2).
    // On call 2, return 127.0.0.1.
    const proxy = await startEgressProxy({
      idleTimeoutMs: 500,
      resolver: async () => {
        callCount++;
        if (callCount === 1) {
          return [{ address: '198.51.100.1', family: 4 }];
        }
        return [{ address: '127.0.0.1', family: 4 }];
      },
    });
    openProxies.push(proxy);

    // Track if any connection reached 127.0.0.1:443
    let reachedLocal = false;
    const localTrap = net.createServer(() => {
      reachedLocal = true;
    });
    await new Promise<void>((r) => localTrap.listen(0, '127.0.0.1', r));
    const trapPort = (localTrap.address() as net.AddressInfo).port;

    const res = await new Promise<string>((resolve) => {
      let buf = '';
      const client = net.connect({ host: '127.0.0.1', port: proxy.port }, () => {
        client.write('CONNECT rebinding.target:443 HTTP/1.1\r\nHost: rebinding.target:443\r\n\r\n');
      });
      client.on('data', (data) => {
        buf += data.toString();
      });
      client.on('close', () => {
        resolve(buf);
      });
    });

    localTrap.close();
    expect(reachedLocal).toBe(false);
    expect(res).toMatch(/HTTP\/1\.1 (502|504)/);
  });

  it('rejects plain HTTP requests to forbidden destinations with 403', async () => {
    const proxy = await startEgressProxy();
    openProxies.push(proxy);

    const testUrls = [
      'http://127.0.0.1:80/secret',
      'http://169.254.169.254/latest/meta-data',
      'http://100.64.1.1:80/',
    ];

    for (const target of testUrls) {
      const statusCode = await new Promise<number>((resolve) => {
        const req = http.request(
          proxy.url,
          {
            method: 'GET',
            path: target,
            headers: { Host: new URL(target).host },
          },
          (res) => {
            resolve(res.statusCode || 0);
          }
        );
        req.end();
      });
      expect(statusCode).toBe(403);
    }
  });

  it('enforces tunnel concurrency limit', async () => {
    const proxy = await startEgressProxy({
      maxConcurrentTunnels: 1,
      // extraAllow so tunnel 1 stays open
      extraAllow: () => true,
    });
    openProxies.push(proxy);

    const mockServer = net.createServer((sock) => {
      // keep socket open
    });
    await new Promise<void>((r) => mockServer.listen(0, '127.0.0.1', r));
    const mockPort = (mockServer.address() as net.AddressInfo).port;

    // Tunnel 1: should establish
    const client1 = net.connect({ host: '127.0.0.1', port: proxy.port }, () => {
      client1.write(`CONNECT 127.0.0.1:${mockPort} HTTP/1.1\r\n\r\n`);
    });
    await new Promise((r) => client1.once('data', r));

    // Tunnel 2: should be rejected with 503
    const res2 = await new Promise<string>((resolve) => {
      const client2 = net.connect({ host: '127.0.0.1', port: proxy.port }, () => {
        client2.write(`CONNECT 127.0.0.1:${mockPort} HTTP/1.1\r\n\r\n`);
      });
      client2.on('data', (d) => {
        resolve(d.toString());
        client2.destroy();
      });
    });

    client1.destroy();
    mockServer.close();
    expect(res2).toContain('HTTP/1.1 503 Service Unavailable');
  });
});
