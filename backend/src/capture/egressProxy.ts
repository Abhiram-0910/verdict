import http from 'node:http';
import net from 'node:net';
import dns from 'node:dns/promises';
import { URL } from 'node:url';

export interface EgressProxyOptions {
  resolver?: (hostname: string) => Promise<{ address: string; family: number }[]>;
  extraAllow?: (host: string, port: number) => boolean;
  idleTimeoutMs?: number;
  maxConcurrentTunnels?: number;
}

export interface EgressProxy {
  port: number;
  url: string;
  close: () => Promise<void>;
}

export function createForbiddenBlockList(): {
  blockList: net.BlockList;
  isForbidden: (address: string, family?: number) => boolean;
} {
  const blockList = new net.BlockList();

  // IPv4 subnets
  blockList.addSubnet('0.0.0.0', 8, 'ipv4');
  blockList.addSubnet('10.0.0.0', 8, 'ipv4');
  blockList.addSubnet('100.64.0.0', 10, 'ipv4');
  blockList.addSubnet('127.0.0.0', 8, 'ipv4');
  blockList.addSubnet('169.254.0.0', 16, 'ipv4');
  blockList.addSubnet('172.16.0.0', 12, 'ipv4');
  blockList.addSubnet('192.0.0.0', 24, 'ipv4');
  blockList.addSubnet('192.168.0.0', 16, 'ipv4');
  blockList.addSubnet('198.18.0.0', 15, 'ipv4');
  blockList.addSubnet('224.0.0.0', 4, 'ipv4');
  blockList.addSubnet('240.0.0.0', 4, 'ipv4');

  // IPv6 subnets
  blockList.addSubnet('::', 128, 'ipv6');
  blockList.addSubnet('::1', 128, 'ipv6');
  blockList.addSubnet('fc00::', 7, 'ipv6');
  blockList.addSubnet('fe80::', 10, 'ipv6');
  blockList.addSubnet('ff00::', 8, 'ipv6');
  blockList.addSubnet('64:ff9b::', 96, 'ipv6');
  blockList.addSubnet('2002::', 16, 'ipv6');

  function extractEmbeddedIPv4(raw: string): string | null {
    const clean = raw.toLowerCase().replace(/^\[|\]$/g, '');
    const matchDotted = clean.match(/^(?:0*:){0,5}(?:::)?ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i);
    if (matchDotted) return matchDotted[1];

    const matchHex = clean.match(/^(?:0*:){0,5}(?:::)?ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
    if (matchHex) {
      const p1 = parseInt(matchHex[1], 16);
      const p2 = parseInt(matchHex[2], 16);
      return `${(p1 >> 8) & 0xff}.${p1 & 0xff}.${(p2 >> 8) & 0xff}.${p2 & 0xff}`;
    }
    return null;
  }

  function isForbidden(address: string, family?: number): boolean {
    const clean = address.replace(/^\[|\]$/g, '');
    const detectedFamily = family === 6 || net.isIPv6(clean) ? 'ipv6' : 'ipv4';

    // Normalization check for IPv4-mapped IPv6 addresses
    const embeddedIPv4 = extractEmbeddedIPv4(clean);
    if (embeddedIPv4) {
      try {
        if (blockList.check(embeddedIPv4, 'ipv4')) return true;
      } catch {}
    }

    try {
      return blockList.check(clean, detectedFamily);
    } catch {
      // If BlockList.check throws on invalid IP format, treat as forbidden for safety
      return true;
    }
  }

  return { blockList, isForbidden };
}

export function parseHostAndPort(raw: string, defaultPort: number): { hostname: string; port: number } | null {
  try {
    if (raw.startsWith('http://') || raw.startsWith('https://')) {
      const u = new URL(raw);
      const port = u.port ? parseInt(u.port, 10) : (u.protocol === 'https:' ? 443 : 80);
      return { hostname: u.hostname.replace(/^\[|\]$/g, ''), port };
    }
    const lastColon = raw.lastIndexOf(':');
    if (lastColon !== -1 && !raw.endsWith(']')) {
      const hostPart = raw.slice(0, lastColon).replace(/^\[|\]$/g, '');
      const portPart = parseInt(raw.slice(lastColon + 1), 10);
      if (isNaN(portPart)) return null;
      return { hostname: hostPart, port: portPart };
    }
    return { hostname: raw.replace(/^\[|\]$/g, ''), port: defaultPort };
  } catch {
    return null;
  }
}

async function defaultResolver(hostname: string): Promise<{ address: string; family: number }[]> {
  return dns.lookup(hostname, { all: true });
}

export function startEgressProxy(options: EgressProxyOptions = {}): Promise<EgressProxy> {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    const idleTimeoutMs = options.idleTimeoutMs ?? 30_000;
    const maxConcurrentTunnels = options.maxConcurrentTunnels ?? 50;
    let activeTunnels = 0;
    const { isForbidden } = createForbiddenBlockList();
    const resolver = options.resolver ?? defaultResolver;
    const sockets = new Set<net.Socket>();

    server.on('connection', (socket) => {
      sockets.add(socket);
      socket.setTimeout(idleTimeoutMs, () => {
        socket.destroy();
      });
      socket.on('close', () => {
        sockets.delete(socket);
      });
      socket.on('error', () => {
        sockets.delete(socket);
      });
    });

    server.on('clientError', (err, socket) => {
      try {
        if (!socket.destroyed) {
          socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
          socket.destroy();
        }
      } catch {}
    });

    // Handle CONNECT (HTTPS and WebSocket tunnels)
    server.on('connect', async (req, clientSocket, head) => {
      if (activeTunnels >= maxConcurrentTunnels) {
        console.warn(`[SSRF Blocked] Concurrent tunnel limit reached (${maxConcurrentTunnels})`);
        try {
          clientSocket.write('HTTP/1.1 503 Service Unavailable\r\n\r\n');
        } catch {}
        clientSocket.destroy();
        return;
      }

      activeTunnels++;
      let cleanedUp = false;
      let upstreamSocket: net.Socket | null = null;

      const cleanupTunnel = () => {
        if (!cleanedUp) {
          cleanedUp = true;
          activeTunnels = Math.max(0, activeTunnels - 1);
        }
      };

      clientSocket.on('close', () => {
        cleanupTunnel();
        if (upstreamSocket && !upstreamSocket.destroyed) upstreamSocket.destroy();
      });
      clientSocket.on('error', () => {
        cleanupTunnel();
        if (upstreamSocket && !upstreamSocket.destroyed) upstreamSocket.destroy();
      });

      const parsed = req.url ? parseHostAndPort(req.url, 443) : null;
      if (!parsed) {
        console.warn(`[SSRF Blocked] Malformed CONNECT URL`);
        cleanupTunnel();
        try { clientSocket.end('HTTP/1.1 400 Bad Request\r\n\r\n'); } catch {}
        clientSocket.destroy();
        return;
      }

      // Check test-only extraAllow predicate
      const isExtraAllowed = options.extraAllow?.(parsed.hostname, parsed.port) ?? false;

      if (!isExtraAllowed) {
        if (parsed.port !== 80 && parsed.port !== 443) {
          console.warn(`[SSRF Blocked] Destination ${parsed.hostname}:${parsed.port} rejected: Port not allowed (only 80, 443)`);
          cleanupTunnel();
          try { clientSocket.end('HTTP/1.1 403 Forbidden\r\n\r\n'); } catch {}
          clientSocket.destroy();
          return;
        }

        let addresses: { address: string; family: number }[];
        try {
          addresses = await resolver(parsed.hostname);
        } catch {
          console.warn(`[SSRF Blocked] Destination ${parsed.hostname}:${parsed.port} rejected: DNS resolution failed`);
          cleanupTunnel();
          try { clientSocket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n'); } catch {}
          clientSocket.destroy();
          return;
        }

        if (!addresses || addresses.length === 0) {
          console.warn(`[SSRF Blocked] Destination ${parsed.hostname}:${parsed.port} rejected: No DNS addresses found`);
          cleanupTunnel();
          try { clientSocket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n'); } catch {}
          clientSocket.destroy();
          return;
        }

        for (const { address, family } of addresses) {
          if (isForbidden(address, family)) {
            console.warn(`[SSRF Blocked] Destination ${parsed.hostname}:${parsed.port} rejected: Resolved to forbidden IP ${address}`);
            cleanupTunnel();
            try { clientSocket.end('HTTP/1.1 403 Forbidden\r\n\r\n'); } catch {}
            clientSocket.destroy();
            return;
          }
        }

        if (clientSocket.destroyed) {
          cleanupTunnel();
          return;
        }

        // Pause client timeout while connecting upstream
        if ('setTimeout' in clientSocket && typeof (clientSocket as net.Socket).setTimeout === 'function') {
          (clientSocket as net.Socket).setTimeout(0);
        }

        // Connect upstream socket to the validated IP itself (prevents DNS rebinding)
        const targetIp = addresses[0].address;
        upstreamSocket = net.connect({
          host: targetIp,
          port: parsed.port,
        });

        upstreamSocket.setTimeout(idleTimeoutMs, () => {
          upstreamSocket?.destroy(new Error('Upstream connection timeout'));
        });

        upstreamSocket.on('connect', () => {
          if (cleanedUp || clientSocket.destroyed) {
            upstreamSocket?.destroy();
            return;
          }
          if ('setTimeout' in clientSocket && typeof (clientSocket as net.Socket).setTimeout === 'function') {
            (clientSocket as net.Socket).setTimeout(idleTimeoutMs, () => clientSocket.destroy());
          }
          upstreamSocket?.setTimeout(idleTimeoutMs, () => upstreamSocket?.destroy());
          try {
            clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
            if (head && head.length > 0) {
              upstreamSocket?.write(head);
            }
            upstreamSocket?.pipe(clientSocket);
            clientSocket.pipe(upstreamSocket!);
          } catch {
            cleanupTunnel();
            upstreamSocket?.destroy();
            clientSocket.destroy();
          }
        });

        upstreamSocket.on('error', (err) => {
          cleanupTunnel();
          const isTimeout = err?.message?.includes('timeout');
          const statusLine = isTimeout ? 'HTTP/1.1 504 Gateway Timeout' : 'HTTP/1.1 502 Bad Gateway';
          try {
            if (!clientSocket.destroyed) {
              clientSocket.end(`${statusLine}\r\n\r\n`);
              clientSocket.destroy();
            }
          } catch {}
        });

        upstreamSocket.on('close', () => {
          cleanupTunnel();
          if (!clientSocket.destroyed) clientSocket.destroy();
        });
      } else {
        // Test-only extraAllow path
        if ('setTimeout' in clientSocket && typeof (clientSocket as net.Socket).setTimeout === 'function') {
          (clientSocket as net.Socket).setTimeout(0);
        }
        upstreamSocket = net.connect({
          host: parsed.hostname,
          port: parsed.port,
        });

        upstreamSocket.setTimeout(idleTimeoutMs, () => {
          upstreamSocket?.destroy(new Error('Upstream connection timeout'));
        });

        upstreamSocket.on('connect', () => {
          if (cleanedUp || clientSocket.destroyed) {
            upstreamSocket?.destroy();
            return;
          }
          if ('setTimeout' in clientSocket && typeof (clientSocket as net.Socket).setTimeout === 'function') {
            (clientSocket as net.Socket).setTimeout(idleTimeoutMs, () => clientSocket.destroy());
          }
          upstreamSocket?.setTimeout(idleTimeoutMs, () => upstreamSocket?.destroy());
          try {
            clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
            if (head && head.length > 0) {
              upstreamSocket?.write(head);
            }
            upstreamSocket?.pipe(clientSocket);
            clientSocket.pipe(upstreamSocket!);
          } catch {
            cleanupTunnel();
            upstreamSocket?.destroy();
            clientSocket.destroy();
          }
        });

        upstreamSocket.on('error', (err) => {
          cleanupTunnel();
          const isTimeout = err?.message?.includes('timeout');
          const statusLine = isTimeout ? 'HTTP/1.1 504 Gateway Timeout' : 'HTTP/1.1 502 Bad Gateway';
          try {
            if (!clientSocket.destroyed) {
              clientSocket.end(`${statusLine}\r\n\r\n`);
              clientSocket.destroy();
            }
          } catch {}
        });

        upstreamSocket.on('close', () => {
          cleanupTunnel();
          if (!clientSocket.destroyed) clientSocket.destroy();
        });
      }
    });

    // Handle Plain HTTP requests (absolute-URI form)
    server.on('request', async (req, res) => {
      if (activeTunnels >= maxConcurrentTunnels) {
        console.warn(`[SSRF Blocked] Concurrent tunnel limit reached (${maxConcurrentTunnels})`);
        res.writeHead(503, { 'Content-Type': 'text/plain' });
        res.end('Service Unavailable');
        return;
      }

      activeTunnels++;
      let cleanedUp = false;
      const cleanupTunnel = () => {
        if (!cleanedUp) {
          cleanedUp = true;
          activeTunnels = Math.max(0, activeTunnels - 1);
        }
      };

      res.on('finish', cleanupTunnel);
      res.on('close', cleanupTunnel);

      const parsed = req.url ? parseHostAndPort(req.url, 80) : null;
      if (!parsed) {
        console.warn(`[SSRF Blocked] Malformed HTTP URL`);
        cleanupTunnel();
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('Bad Request');
        return;
      }

      const isExtraAllowed = options.extraAllow?.(parsed.hostname, parsed.port) ?? false;

      let targetHost = parsed.hostname;
      let targetPort = parsed.port;

      if (!isExtraAllowed) {
        if (parsed.port !== 80 && parsed.port !== 443) {
          console.warn(`[SSRF Blocked] Destination ${parsed.hostname}:${parsed.port} rejected: Port not allowed (only 80, 443)`);
          cleanupTunnel();
          res.writeHead(403, { 'Content-Type': 'text/plain' });
          res.end('Forbidden: Port not allowed');
          return;
        }

        let addresses: { address: string; family: number }[];
        try {
          addresses = await resolver(parsed.hostname);
        } catch {
          console.warn(`[SSRF Blocked] Destination ${parsed.hostname}:${parsed.port} rejected: DNS resolution failed`);
          cleanupTunnel();
          res.writeHead(502, { 'Content-Type': 'text/plain' });
          res.end('Bad Gateway: DNS lookup failed');
          return;
        }

        if (!addresses || addresses.length === 0) {
          console.warn(`[SSRF Blocked] Destination ${parsed.hostname}:${parsed.port} rejected: No DNS addresses found`);
          cleanupTunnel();
          res.writeHead(502, { 'Content-Type': 'text/plain' });
          res.end('Bad Gateway: No DNS addresses');
          return;
        }

        for (const { address, family } of addresses) {
          if (isForbidden(address, family)) {
            console.warn(`[SSRF Blocked] Destination ${parsed.hostname}:${parsed.port} rejected: Resolved to forbidden IP ${address}`);
            cleanupTunnel();
            res.writeHead(403, { 'Content-Type': 'text/plain' });
            res.end('Forbidden: SSRF Blocked');
            return;
          }
        }

        // Connect to validated IP
        targetHost = addresses[0].address;
      }

      let forwardPath = req.url || '/';
      try {
        if (req.url && (req.url.startsWith('http://') || req.url.startsWith('https://'))) {
          const u = new URL(req.url);
          forwardPath = u.pathname + u.search;
        }
      } catch {}

      const forwardHeaders = { ...req.headers };
      if (!forwardHeaders.host) {
        forwardHeaders.host = parsed.hostname + (parsed.port === 80 || parsed.port === 443 ? '' : `:${parsed.port}`);
      }

      const upstreamReq = http.request(
        {
          host: targetHost,
          port: targetPort,
          method: req.method,
          path: forwardPath,
          headers: forwardHeaders,
        },
        (upstreamRes) => {
          res.writeHead(upstreamRes.statusCode || 200, upstreamRes.headers);
          upstreamRes.pipe(res);
        }
      );

      upstreamReq.setTimeout(idleTimeoutMs, () => {
        upstreamReq.destroy(new Error('Upstream timeout'));
      });

      upstreamReq.on('error', () => {
        cleanupTunnel();
        if (!res.headersSent) {
          res.writeHead(502, { 'Content-Type': 'text/plain' });
          res.end('Bad Gateway');
        }
      });

      req.on('error', () => {
        cleanupTunnel();
        upstreamReq.destroy();
      });

      res.on('error', () => {
        cleanupTunnel();
        upstreamReq.destroy();
      });

      req.on('close', () => {
        if (!res.writableEnded) {
          upstreamReq.destroy();
        }
      });

      req.pipe(upstreamReq);
    });

    // Also handle upgrade requests for plain HTTP WebSockets (ws://)
    server.on('upgrade', async (req, clientSocket, head) => {
      if (activeTunnels >= maxConcurrentTunnels) {
        console.warn(`[SSRF Blocked] Concurrent tunnel limit reached (${maxConcurrentTunnels})`);
        try {
          clientSocket.write('HTTP/1.1 503 Service Unavailable\r\n\r\n');
        } catch {}
        clientSocket.destroy();
        return;
      }

      activeTunnels++;
      let cleanedUp = false;
      let upstreamSocket: net.Socket | null = null;
      const cleanupTunnel = () => {
        if (!cleanedUp) {
          cleanedUp = true;
          activeTunnels = Math.max(0, activeTunnels - 1);
        }
      };

      clientSocket.on('close', () => {
        cleanupTunnel();
        if (upstreamSocket && !upstreamSocket.destroyed) upstreamSocket.destroy();
      });
      clientSocket.on('error', () => {
        cleanupTunnel();
        if (upstreamSocket && !upstreamSocket.destroyed) upstreamSocket.destroy();
      });

      const parsed = req.url ? parseHostAndPort(req.url, 80) : null;
      if (!parsed) {
        cleanupTunnel();
        try {
          clientSocket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
        } catch {}
        clientSocket.destroy();
        return;
      }

      const isExtraAllowed = options.extraAllow?.(parsed.hostname, parsed.port) ?? false;
      if (!isExtraAllowed) {
        if (parsed.port !== 80 && parsed.port !== 443) {
          console.warn(`[SSRF Blocked] WebSocket destination ${parsed.hostname}:${parsed.port} rejected: Port not allowed`);
          cleanupTunnel();
          try {
            clientSocket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
          } catch {}
          clientSocket.destroy();
          return;
        }

        let addresses: { address: string; family: number }[];
        try {
          addresses = await resolver(parsed.hostname);
        } catch {
          cleanupTunnel();
          try {
            clientSocket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n');
          } catch {}
          clientSocket.destroy();
          return;
        }

        if (!addresses || addresses.length === 0) {
          cleanupTunnel();
          try {
            clientSocket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n');
          } catch {}
          clientSocket.destroy();
          return;
        }

        for (const { address, family } of addresses) {
          if (isForbidden(address, family)) {
            console.warn(`[SSRF Blocked] WebSocket destination ${parsed.hostname}:${parsed.port} rejected: Resolved to forbidden IP ${address}`);
            cleanupTunnel();
            try {
              clientSocket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
            } catch {}
            clientSocket.destroy();
            return;
          }
        }

        const targetIp = addresses[0].address;
        upstreamSocket = net.connect({
          host: targetIp,
          port: parsed.port,
        });

        upstreamSocket.setTimeout(idleTimeoutMs, () => {
          upstreamSocket?.destroy(new Error('Upstream timeout'));
        });

        upstreamSocket.on('connect', () => {
          if (cleanedUp || clientSocket.destroyed) {
            upstreamSocket?.destroy();
            return;
          }
          try {
            let rawReq = `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`;
            for (let i = 0; i < req.rawHeaders.length; i += 2) {
              rawReq += `${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}\r\n`;
            }
            rawReq += '\r\n';
            upstreamSocket?.write(rawReq);
            if (head && head.length > 0) upstreamSocket?.write(head);
            upstreamSocket?.pipe(clientSocket);
            clientSocket.pipe(upstreamSocket!);
          } catch {
            cleanupTunnel();
            upstreamSocket?.destroy();
            clientSocket.destroy();
          }
        });

        upstreamSocket.on('error', () => {
          cleanupTunnel();
          try {
            clientSocket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n');
          } catch {}
          clientSocket.destroy();
        });

        upstreamSocket.on('close', () => {
          cleanupTunnel();
          if (!clientSocket.destroyed) clientSocket.destroy();
        });
      } else {
        // Test-only extraAllow path
        upstreamSocket = net.connect({
          host: parsed.hostname,
          port: parsed.port,
        });

        upstreamSocket.setTimeout(idleTimeoutMs, () => {
          upstreamSocket?.destroy(new Error('Upstream timeout'));
        });

        upstreamSocket.on('connect', () => {
          if (cleanedUp || clientSocket.destroyed) {
            upstreamSocket?.destroy();
            return;
          }
          try {
            let rawReq = `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`;
            for (let i = 0; i < req.rawHeaders.length; i += 2) {
              rawReq += `${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}\r\n`;
            }
            rawReq += '\r\n';
            upstreamSocket?.write(rawReq);
            if (head && head.length > 0) upstreamSocket?.write(head);
            upstreamSocket?.pipe(clientSocket);
            clientSocket.pipe(upstreamSocket!);
          } catch {
            cleanupTunnel();
            upstreamSocket?.destroy();
            clientSocket.destroy();
          }
        });

        upstreamSocket.on('error', () => {
          cleanupTunnel();
          try {
            clientSocket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n');
          } catch {}
          clientSocket.destroy();
        });

        upstreamSocket.on('close', () => {
          cleanupTunnel();
          if (!clientSocket.destroyed) clientSocket.destroy();
        });
      }
    });

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        reject(new Error('Failed to get egress proxy address'));
        return;
      }
      const port = addr.port;
      const proxy: EgressProxy = {
        port,
        url: `http://127.0.0.1:${port}`,
        close: () => {
          return new Promise<void>((resClose) => {
            for (const socket of sockets) {
              try {
                socket.destroy();
              } catch {}
            }
            sockets.clear();
            server.close(() => resClose());
          });
        },
      };
      resolve(proxy);
    });

    server.on('error', (err) => {
      reject(err);
    });
  });
}

let globalProxy: EgressProxy | null = null;
let startingPromise: Promise<EgressProxy> | null = null;

export async function getGlobalEgressProxy(): Promise<EgressProxy> {
  if (globalProxy) {
    return globalProxy;
  }
  if (startingPromise) {
    return startingPromise;
  }
  startingPromise = startEgressProxy()
    .then((proxy) => {
      globalProxy = proxy;
      startingPromise = null;
      console.log(`[EgressProxy] Running on 127.0.0.1:${proxy.port}`);
      return proxy;
    })
    .catch((err) => {
      startingPromise = null;
      throw err;
    });
  return startingPromise;
}

export async function closeGlobalEgressProxy(): Promise<void> {
  if (globalProxy) {
    const proxy = globalProxy;
    globalProxy = null;
    await proxy.close();
  }
}
