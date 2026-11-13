import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const tlsDir = path.resolve(__dirname, '../infrastructure/local/floci/.tls');
const certPath = process.env.FLOCI_TLS_CERT || path.join(tlsDir, 'floci-az.crt');
const keyPath = process.env.FLOCI_TLS_KEY || path.join(tlsDir, 'floci-az.key');
const targetHost = process.env.FLOCI_TARGET_HOST || 'localhost';
const targetPort = parseInt(process.env.FLOCI_TARGET_PORT || '4577', 10);
const proxyPort = parseInt(process.env.FLOCI_PROXY_PORT || '4578', 10);

// Ensure TLS directory and assets exist
if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) {
  fs.mkdirSync(tlsDir, { recursive: true });
  try {
    console.log('[Floci Proxy] Extracting TLS certificate and key from floci-azure-arm container...');
    const certBuf = execSync('docker exec floci-azure-arm cat /app/data/tls/floci-az-selfsigned.crt');
    const keyBuf = execSync('docker exec floci-azure-arm cat /app/data/tls/floci-az-selfsigned.key');
    fs.writeFileSync(certPath, certBuf);
    fs.writeFileSync(keyPath, keyBuf);
  } catch (err) {
    console.error(`[Floci Proxy] Failed to extract TLS assets from container: ${err.message}`);
    process.exit(1);
  }
}

const cert = fs.readFileSync(certPath);
const key = fs.readFileSync(keyPath);

const getLocalFallbackMetadata = (url) => {
  const is2019 = url && url.includes('2019-05-01');
  const baseEntry = {
    portal: 'https://portal.azure.com',
    authentication: {
      loginEndpoint: `https://${targetHost}:${targetPort}/`,
      audiences: [
        'https://management.core.windows.net/',
        `https://${targetHost}:${targetPort}/`
      ],
      tenant: 'common',
      identityProvider: 'AAD'
    },
    media: 'https://rest.media.azure.net',
    graphAudience: 'https://graph.windows.net/',
    graph: 'https://graph.windows.net/',
    name: 'AzureCloud',
    suffixes: {
      azureDataLakeStoreFileSystem: 'azuredatalakestore.net',
      acrLoginServer: 'azurecr.io',
      sqlServerHostname: 'database.windows.net',
      azureDataLakeAnalyticsCatalogAndJob: 'azuredatalakeanalytics.net',
      keyVaultDns: 'vault.azure.net',
      storage: 'core.windows.net',
      azureFrontDoorEndpointSuffix: 'azurefd.net',
      storageSyncEndpointSuffix: 'afs.azure.net',
      mhsmDns: 'managedhsm.azure.net',
      mysqlServerEndpoint: 'mysql.database.azure.com',
      postgresqlServerEndpoint: 'postgres.database.azure.com',
      mariadbServerEndpoint: 'mariadb.database.azure.com',
      synapseAnalytics: 'dev.azuresynapse.net',
      attestationEndpoint: 'attest.azure.net'
    },
    batch: 'https://batch.core.windows.net/',
    resourceManager: `https://${targetHost}:${targetPort}/`,
    vmImageAliasDoc: 'https://raw.githubusercontent.com/Azure/azure-rest-api-specs/master/arm-compute/quickstart-templates/aliases.json',
    activeDirectoryDataLake: 'https://datalake.azure.net/',
    sqlManagement: 'https://management.core.windows.net:8443/',
    gallery: 'https://gallery.azure.com/',
    appInsightsResourceId: 'https://api.applicationinsights.io',
    appInsightsTelemetryChannelResourceId: 'https://dc.applicationinsights.azure.com/v2/track',
    attestationResourceId: 'https://attest.azure.net',
    logAnalyticsResourceId: 'https://api.loganalytics.io',
    microsoftGraphResourceId: 'https://graph.microsoft.com/',
    ossrDbmsResourceId: 'https://ossrdbms-aad.database.windows.net',
    synapseAnalyticsResourceId: 'https://dev.azuresynapse.net'
  };

  return is2019 ? [baseEntry] : baseEntry;
};

const server = https.createServer({ cert, key }, (req, res) => {
  // Liveness / health probe for testing and monitoring
  if (req.url === '/__proxy_health' || req.url === '/health') {
    const healthPayload = JSON.stringify({
      status: 'UP',
      target: `${targetHost}:${targetPort}`,
      proxyPort,
      timestamp: new Date().toISOString()
    });
    res.writeHead(200, {
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(healthPayload)
    });
    res.end(healthPayload);
    return;
  }

  // Intercept and rewrite Azure ARM endpoint metadata queries
  if (req.url && req.url.includes('/metadata/endpoints')) {
    https.get(`https://management.azure.com${req.url}`, (azRes) => {
      let azBody = [];
      azRes.on('data', c => azBody.push(c));
      azRes.on('end', () => {
        let str = Buffer.concat(azBody).toString('utf8');
        str = str.replace(/https:\/\/management\.azure\.com\//g, `https://${targetHost}:${targetPort}/`);
        str = str.replace(/https:\/\/management\.azure\.com/g, `https://${targetHost}:${targetPort}`);
        str = str.replace(/https:\/\/login\.microsoftonline\.com\//g, `https://${targetHost}:${targetPort}/`);
        str = str.replace(/https:\/\/login\.microsoftonline\.com/g, `https://${targetHost}:${targetPort}`);
        res.writeHead(azRes.statusCode, {
          ...azRes.headers,
          'content-length': Buffer.byteLength(str)
        });
        res.end(str);
      });
    }).on('error', () => {
      const fallback = JSON.stringify(getLocalFallbackMetadata(req.url));
      res.writeHead(200, {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(fallback)
      });
      res.end(fallback);
    });
    return;
  }

  // Forward all other ARM calls to local Floci container
  const options = {
    hostname: targetHost,
    port: targetPort,
    path: req.url,
    method: req.method,
    headers: req.headers,
    rejectUnauthorized: false,
    timeout: 30000
  };

  const clientReq = https.request(options, (clientRes) => {
    res.writeHead(clientRes.statusCode, clientRes.headers);
    clientRes.pipe(res);
  });

  clientReq.on('timeout', () => {
    clientReq.destroy(new Error(`Gateway timeout connecting to Floci at ${targetHost}:${targetPort}`));
  });

  clientReq.on('error', (err) => {
    if (!res.headersSent) {
      res.writeHead(502, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'Bad Gateway', message: err.message }));
    }
  });

  req.pipe(clientReq);
});

// Guard against malformed TLS client handshakes without crashing the process
server.on('clientError', (_err, socket) => {
  if (socket.writable) {
    socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
  }
});

// Graceful termination handling
const shutdown = (signal) => {
  console.log(`[Floci Proxy] Received ${signal}, closing proxy server gracefully...`);
  server.close(() => {
    console.log('[Floci Proxy] Proxy server closed cleanly.');
    process.exit(0);
  });
  // Force exit after 3 seconds if existing sockets do not drain
  setTimeout(() => process.exit(0), 3000).unref();
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('uncaughtException', (err) => {
  console.error('[Floci Proxy] Uncaught Exception:', err.message);
});

process.on('unhandledRejection', (reason) => {
  console.error('[Floci Proxy] Unhandled Rejection:', reason);
});

server.listen(proxyPort, () => {
  console.log(`[Floci Proxy] Proxy active on https://localhost:${proxyPort} -> https://${targetHost}:${targetPort}`);
});
