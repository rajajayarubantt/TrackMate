// Link previews: reading a page's metadata, and refusing to fetch anything that is not a public web page.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, before, describe, it } from 'node:test';
import { isPublicUrl, parseHtml, preview } from '../server/preview.js';

describe('reading metadata from HTML', () => {
  it('prefers Open Graph, and makes addresses absolute', () => {
    const meta = parseHtml(
      `<html><head><title>Plain title</title>
        <meta property="og:title" content="Accept a payment &amp; more">
        <meta content='Take payments &#39;online&#39; &mdash; fast' property='og:description'>
        <meta property="og:image" content="/img/banner.png?a=1&amp;b=2">
        <meta property="og:site_name" content="Stripe Docs">
        <link rel="icon" href="/favicon.ico"><link rel="apple-touch-icon" href="touch.png">
      </head><body></body></html>`,
      'https://docs.example.com/payments/accept',
    );
    assert.deepEqual(meta, {
      title: 'Accept a payment & more',
      description: 'Take payments \'online\' — fast',
      image: 'https://docs.example.com/img/banner.png?a=1&b=2',
      favicon: 'https://docs.example.com/payments/touch.png',
      site_name: 'Stripe Docs',
    });
  });

  it('falls back to Twitter cards, the <title> and the plain description', () => {
    const meta = parseHtml(
      '<title>\n  A   page\n</title><meta name=description content="Plain words"><meta name="twitter:image" content="https://cdn.example/x.jpg">',
      'https://example.com/',
    );
    assert.equal(meta.title, 'A page');
    assert.equal(meta.description, 'Plain words');
    assert.equal(meta.image, 'https://cdn.example/x.jpg');
    assert.equal(meta.favicon, '');
  });

  it('ignores images that are not web addresses', () => {
    assert.equal(parseHtml('<meta property="og:image" content="javascript:alert(1)">', 'https://example.com/').image, '');
    assert.equal(parseHtml('<meta property="og:image" content="data:image/png;base64,AAAA">', 'https://example.com/').image, '');
  });
});

describe('which addresses may be fetched', () => {
  const blocked = [
    'http://localhost/', 'http://app.localhost/', 'http://127.0.0.1/', 'http://127.1/', 'http://2130706433/', 'http://0x7f.0.0.1/',
    'http://10.0.0.5/', 'http://172.16.4.1/', 'http://192.168.1.1/', 'http://169.254.169.254/latest/meta-data/', 'http://100.64.0.1/',
    'http://0.0.0.0/', 'http://[::1]/', 'http://[::ffff:127.0.0.1]/', 'http://[fd00::1]/', 'http://[fe80::1]/', 'http://printer.local/',
    'http://db.internal/', 'ftp://example.com/', 'file:///etc/passwd', 'https://user:pass@93.184.216.34/',
  ];
  for (const address of blocked) {
    it(`refuses ${address}`, async () => assert.equal(await isPublicUrl(new URL(address)), false));
  }
  for (const address of ['https://93.184.216.34/', 'http://192.0.66.2/page', 'https://[2606:2800:220:1:248:1893:25c8:1946]/']) {
    it(`allows ${address}`, async () => assert.equal(await isPublicUrl(new URL(address)), true));
  }
});

describe('fetching a page', () => {
  const allowAll = async () => true;
  const page = (html, init = {}) => new Response(html, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, ...init });

  it('follows redirects, checking every hop', async () => {
    const seen = [];
    const fetcher = async (url) => {
      seen.push(String(url));
      if (seen.length === 1) return new Response(null, { status: 302, headers: { location: '/moved' } });
      if (seen.length === 2) return new Response(null, { status: 301, headers: { location: 'https://final.example/page' } });
      return page('<title>Arrived</title><meta property="og:image" content="pic.png">');
    };
    const meta = await preview('https://start.example/a', fetcher, allowAll);
    assert.deepEqual(seen, ['https://start.example/a', 'https://start.example/moved', 'https://final.example/page']);
    assert.equal(meta.title, 'Arrived');
    assert.equal(meta.image, 'https://final.example/pic.png');
  });

  it('will not follow a redirect to a private address', async () => {
    let fetched = 0;
    const fetcher = async () => {
      fetched++;
      return new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data/' } });
    };
    assert.equal(await preview('https://93.184.216.34/', fetcher), null);
    assert.equal(fetched, 1, 'the private address is never requested');
  });

  it('gives up after too many redirects', async () => {
    let fetched = 0;
    const fetcher = async (url) => {
      fetched++;
      return new Response(null, { status: 302, headers: { location: `${url}x` } });
    };
    assert.equal(await preview('https://loop.example/', fetcher, allowAll), null);
    assert.equal(fetched, 5);
  });

  it('returns nothing for errors, non-pages and pages without metadata', async () => {
    assert.equal(await preview('not a url', async () => page('<title>x</title>'), allowAll), null);
    assert.equal(await preview('https://a.example/', async () => new Response('nope', { status: 404 }), allowAll), null);
    assert.equal(await preview('https://a.example/', async () => new Response('%PDF', { headers: { 'content-type': 'application/pdf' } }), allowAll), null);
    assert.equal(await preview('https://a.example/', async () => page('<p>no head here</p>'), allowAll), null);
    assert.equal(await preview('https://a.example/', async () => { throw new Error('connection reset'); }, allowAll), null);
  });

  it('uses a linked image as its own banner', async () => {
    const meta = await preview('https://a.example/photo.jpg', async () => new Response('…', { headers: { 'content-type': 'image/jpeg' } }), allowAll);
    assert.equal(meta.image, 'https://a.example/photo.jpg');
  });

  describe('over real HTTP', () => {
    let server;
    let base;
    before(async () => {
      server = createServer((req, res) => {
        if (req.url === '/latin1') {
          res.writeHead(200, { 'content-type': 'text/html; charset=iso-8859-1' });
          res.end(Buffer.from('<title>Caf\xe9 M\xfcnchen</title>', 'latin1'));
        } else if (req.url === '/big') {
          res.writeHead(200, { 'content-type': 'text/html' });
          res.write('<head><title>Big page</title><meta property="og:description" content="Still found"></head>');
          const filler = 'x'.repeat(64_000);
          let sent = 0;
          const pump = () => {
            while (sent < 80) {
              sent++;
              if (!res.write(filler)) return void res.once('drain', pump);
            }
            res.end('<meta property="og:image" content="/never-reached.png">');
          };
          res.on('error', () => undefined);
          pump();
        } else if (req.url === '/agent') {
          res.writeHead(200, { 'content-type': 'text/html' });
          res.end(`<title>${req.headers['user-agent']}</title>`);
        } else {
          res.writeHead(302, { location: '/latin1' }).end();
        }
      });
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      base = `http://127.0.0.1:${server.address().port}`;
    });
    after(() => server.close());

    it('refuses this very server unless told otherwise (it is on a private address)', async () => {
      assert.equal(await preview(`${base}/latin1`), null);
    });
    it('decodes the page with the character set it declares, after a redirect', async () => {
      assert.equal((await preview(`${base}/start`, fetch, allowAll)).title, 'Café München');
    });
    it('stops reading a very large page early but keeps what the head said', async () => {
      const meta = await preview(`${base}/big`, fetch, allowAll);
      assert.equal(meta.title, 'Big page');
      assert.equal(meta.description, 'Still found');
      assert.equal(meta.image, '');
    });
    it('identifies itself honestly', async () => {
      assert.match((await preview(`${base}/agent`, fetch, allowAll)).title, /TrackMateLinkPreview/);
    });
  });
});
