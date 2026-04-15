const express = require('express');
const fs = require('fs');
const path = require('path');
const { getFeedDir } = require('./rss-generator');
const { resolveFeedBaseUrl } = require('./feed-url-base');

let server = null;

/**
 * Start a local Express server that serves the generated RSS/Atom feed files.
 * Any RSS reader can subscribe to:  http://localhost:<port>/feed/<username>
 */
function startFeedServer(store) {
  const port = store.get('serverPort');
  const app = express();

  // CORS — allow RSS readers to fetch
  app.use((_req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    next();
  });

  // Token authentication — protects all routes when a token is configured.
  // Accepts ?token=<value> query param  OR  Authorization: Bearer <value> header.
  app.use((req, res, next) => {
    const expectedToken = store.get('feedToken');
    if (!expectedToken) return next();

    const queryToken = req.query.token;
    const headerToken = (req.headers.authorization || '').startsWith('Bearer ')
      ? req.headers.authorization.slice(7)
      : null;

    if (queryToken === expectedToken || headerToken === expectedToken) {
      return next();
    }

    res.status(401).json({ error: 'Unauthorized — valid token required' });
  });

  // Test endpoint — always returns a minimal valid RSS feed, no auth required
  app.get('/feed/test', (_req, res) => {
    res.set('Content-Type', 'application/rss+xml');
    res.set('Cache-Control', 'no-store');
    res.send(`<?xml version="1.0"?>
<rss version="2.0">
  <channel>
    <title>Test</title>
    <link>http://localhost</link>
    <description>Test</description>
    <item>
      <title>Item 1</title>
      <link>http://localhost/1</link>
      <description>OK</description>
    </item>
  </channel>
</rss>`);
  });

  // RSS feed endpoint
  app.get('/feed/:username', (req, res) => {
    const { username } = req.params;
    const format = req.query.format === 'atom' ? 'atom' : 'rss';
    const ext = format === 'atom' ? 'atom.xml' : 'rss.xml';
    const filePath = path.join(getFeedDir(), `${username}.${ext}`);

    if (!fs.existsSync(filePath)) {
      return res.status(404).send(`Feed not found for @${username}`);
    }

    const contentType =
      format === 'atom' ? 'application/atom+xml' : 'application/rss+xml';
    res.header('Content-Type', `${contentType}; charset=utf-8`);
    const cacheEnabled = store.get('httpCacheEnabled', false);
    if (!cacheEnabled) {
      res.header('Cache-Control', 'no-store');
    }
    res.sendFile(filePath, { etag: cacheEnabled, lastModified: cacheEnabled });
  });

  // List all available feeds (handy for discovery)
  app.get('/', (_req, res) => {
    const feedDir = getFeedDir();
    if (!fs.existsSync(feedDir)) {
      return res.json({ feeds: [] });
    }

    const files = fs
      .readdirSync(feedDir)
      .filter((f) => f.endsWith('.rss.xml'))
      .map((f) => f.replace('.rss.xml', ''));

    const feedBase = resolveFeedBaseUrl(store);
    const token = store.get('feedToken');
    const tokenSuffix = token || '';
    const feeds = files.map((username) => ({
      username,
      rss: `${feedBase}/feed/${username}` + (tokenSuffix ? `?token=${tokenSuffix}` : ''),
      atom: `${feedBase}/feed/${username}?format=atom` + (tokenSuffix ? `&token=${tokenSuffix}` : ''),
    }));

    res.json({ feeds });
  });

  server = app.listen(port, '127.0.0.1', () => {
    console.log(`RSS feed server running at http://localhost:${port}/`);
  });

  server.on('error', (err) => {
    console.error('Feed server error:', err.message);
  });
}

function stopFeedServer() {
  if (server) {
    server.close();
    server = null;
  }
}

module.exports = { startFeedServer, stopFeedServer };
