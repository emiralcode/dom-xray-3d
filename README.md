# DOM·XRAY 3D — Website X-Ray

Analyzes any website's **DOM structure** and **network traffic** with headless Chromium and turns
them into an explorable 3D world:

- **DOM city**: every HTML element is a building. Big `div` blocks become wide platforms and skyscrapers,
  and deeply nested wrapper chains stand out as tall, thin towers.
- **Network space**: every domain is a planet and every loaded resource (script, image, CSS, font, API request)
  is a satellite orbiting it. Satellite size = bytes downloaded, so heavy scripts become huge satellites.
- **Dependency graph**: flowing light lines show which domain loaded resources from which (CDP initiator chain).

## Quick start

```bash
npm install
npm run setup     # downloads Playwright's Chromium (once)
npm start         # http://localhost:3000
```

Requires Node.js 18+. If Chromium cannot be downloaded, the system's Chrome or Edge is used automatically.

To open a site directly: `http://localhost:3000/?url=github.com`

## Features

| Area | Details |
| --- | --- |
| Two 3D layouts | **City** (squarified treemap: area = number of descendants, height = depth) and **Page layout** (real `getBoundingClientRect` positions, every DOM level is one floor). Animated transitions between them. |
| Bloat score | A–F grade based on DOM size, depth, total transfer, JS weight, request count, third-party share and “div soup”. |
| Inspector | Click a building / satellite / planet for its CSS path, ancestor chain, children, size, transfer, compression, status code, protocol, initiator chain and “resources it loaded”. |
| Selector search | Highlights buildings matching selectors such as `div`, `.card`, `#app`, `a.btn`, `img, video`. |
| Timeline | Replays network traffic: resources launch out of the document core at the moment they load and settle into orbit. A mini waterfall chart sits behind the slider. |
| Filters | Toggle DOM categories and resource types from the legend; hidden (`display:none`) elements can be hidden separately. |
| Performance | Thousands of elements are drawn with a single `InstancedMesh`; picking uses custom ray–AABB / ray–sphere tests instead of the Three.js raycaster. Edge glow and the X-ray scan ring are injected into the shaders. |
| Export / import | Download an analysis as JSON; drag and drop a JSON file onto the window to view it again without the server. |

### Shortcuts

`Click` select · `Double-click`/`F` focus · `L` switch layout · `/` search · `S` scan · `P` replay traffic · `U` parent element · `R` reset camera · `Esc` clear

## Architecture

```
server/
  index.js      Express + SSE (/api/analyze): streams progress steps live, 10 min cache, rate limiting
  analyzer.js   Playwright + Chrome DevTools Protocol: network log (transfer, initiator, timing),
                auto-scroll for lazy loading, DOM tree + layout extraction, Web Vitals, screenshot
  security.js   SSRF protection: blocks localhost / private IP / cloud metadata addresses both in the
                input URL and in every request the page makes
public/
  js/model.js           raw data → tree statistics, score, selector compiler
  js/scene/engine.js    renderer, camera, OrbitControls, UnrealBloom, CSS2D labels, camera flights
  js/scene/layouts.js   treemap city and real page layout algorithms
  js/scene/city.js      DOM buildings (InstancedMesh), animations, highlighting, picking
  js/scene/network.js   planets, satellites, orbits, flow lines, initiator chain
  js/scene/materials.js custom shader injections (edge glow, fresnel, scan, grid)
  js/ui/*               report and inspector panels
```

There is no build step: Three.js is served as ES modules straight from `node_modules`.

## Configuration (environment variables)

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `3000` | Server port |
| `MAX_CONCURRENT` | `2` | Number of analyses running at once (extra requests are queued) |
| `MAX_NODES` | `12000` | Maximum number of DOM elements to visualize |
| `NAV_TIMEOUT` | `30000` | Page load timeout (ms) |
| `RATE_MAX` | `12` | Maximum analyses per IP per minute |
| `ALLOW_PRIVATE` | — | Set to `1` to allow analyzing localhost / private network addresses (local development only) |

## Notes

- “Third party” is decided by registrable domain; a site's own CDNs (e.g. `github.com` → `githubassets.com`)
  count as first-party based on name similarity. Own CDNs with different names (e.g. `wikipedia.org` → `wikimedia.org`) appear as third-party.
- Transfer sizes are CDP `encodedDataLength` values (compressed, headers included).
- The `?debug` parameter preserves the WebGL buffer (for screenshots / automated tests).
