# Free APIs for AI Agent Tools — Verified Reference

> All APIs on this page have been **live-tested and verified** (2026-03-20/21).
> Only APIs that returned HTTP 200 with valid data are listed. **26 verified, 13 rejected.**
> No API key required unless noted. ReadURL (#11) requires an API key.

---

## Quick Reference — Top 5 for Agent Development

| Tool | API | Latency | Why |
|------|-----|---------|-----|
| `search_knowledge` | [Wikipedia](#3-wikipedia-rest-api--knowledge--facts) | 0.2s | Most stable knowledge source, clean summaries |
| `get_weather` | [Open-Meteo](#2-open-meteo--weather-forecast) | 1.2s | Only reliable free weather API, no key |
| `get_time` | [TimeAPI.io](#1-timeapiio--current-time--timezone) | 0.6s | Most common agent query |
| `calculate` | [Math.js](#12-mathjs--mathematical-computation) | 1.5s | Prevents LLM math errors |
| `convert_currency` | [open.er-api.com](#23-open-exchange-rates--currency-rates) | 0.13s | Fastest currency API tested |

---

## Core APIs (1-8)

### 1. TimeAPI.io — Current Time & Timezone

```
GET https://timeapi.io/api/Time/current/zone?timeZone=Asia/Singapore
```

**Response:**
```json
{
  "year": 2026, "month": 3, "day": 20,
  "hour": 23, "minute": 51, "seconds": 9,
  "dateTime": "2026-03-20T23:51:09.6608594",
  "timeZone": "Asia/Singapore",
  "dayOfWeek": "Friday",
  "dstActive": false
}
```

| Auth | CORS | Latency | Rate Limit | Use Case |
|------|------|---------|------------|----------|
| None | Yes | ~0.6s | Free tier has limits | `get_time` tool, scheduling agents |

> **Note:** WorldTimeAPI (`worldtimeapi.org`) is frequently recommended but was **unreachable** during testing. Use TimeAPI.io instead.

---

### 2. Open-Meteo — Weather Forecast

```
GET https://api.open-meteo.com/v1/forecast?latitude=35.6762&longitude=139.6503&current_weather=true
```

**Response:**
```json
{
  "current_weather": {
    "temperature": 5.6, "windspeed": 5.7,
    "winddirection": 57, "weathercode": 0, "is_day": 0
  }
}
```

| Auth | CORS | Latency | Rate Limit | Use Case |
|------|------|---------|------------|----------|
| None | Yes | ~1.2s | 10,000 req/day | `get_weather` tool |

> Requires latitude/longitude. Combine with Nominatim (#5) for city → coordinates conversion.

---

### 3. Wikipedia REST API — Knowledge / Facts

```
GET https://en.wikipedia.org/api/rest_v1/page/summary/Artificial_intelligence
```

**Response:**
```json
{
  "title": "Artificial intelligence",
  "extract": "Artificial intelligence (AI) is the capability of computational systems...",
  "description": "Ability of systems to perceive, synthesize, and infer information",
  "content_urls": { "desktop": { "page": "https://en.wikipedia.org/wiki/..." } }
}
```

| Auth | CORS | Latency | Rate Limit | Use Case |
|------|------|---------|------------|----------|
| None | Yes | ~0.2s | Generous | `search_knowledge` tool, RAG, fact lookup |

---

### 4. Frankfurter — Currency Exchange Rates

```
GET https://api.frankfurter.app/latest?amount=1&from=USD&to=SGD,EUR,JPY,MYR,GBP
```

**Response:**
```json
{
  "amount": 1.0, "base": "USD", "date": "2026-03-20",
  "rates": { "EUR": 0.86543, "GBP": 0.74806, "JPY": 158.77, "MYR": 3.9395, "SGD": 1.2802 }
}
```

| Auth | CORS | Latency | Rate Limit | Use Case |
|------|------|---------|------------|----------|
| None | Yes | ~0.8s | Generous | `convert_currency` tool |

> ECB data, updated daily on weekdays. See also #23 (open.er-api.com) for a faster alternative (0.13s).

---

### 5. Nominatim (OpenStreetMap) — Geocoding

```
GET https://nominatim.openstreetmap.org/search?q=Kuala+Lumpur&format=json&limit=1
```

**Required header:** `User-Agent: YourAppName/1.0`

**Response:**
```json
[{ "display_name": "Kuala Lumpur, Malaysia", "lat": "3.1516964", "lon": "101.6942371", "type": "city" }]
```

| Auth | CORS | Latency | Rate Limit | Use Case |
|------|------|---------|------------|----------|
| None (must send User-Agent) | Yes | ~0.4s | **1 req/s (strict)** | City → lat/lon, location queries |

> **Important:** Without `User-Agent` header, requests return 403. Rate limit is strictly enforced.

---

### 6. Free Dictionary API — Definitions

```
GET https://api.dictionaryapi.dev/api/v2/entries/en/algorithm
```

**Response:**
```json
[{
  "word": "algorithm",
  "phonetics": [{ "text": "/ˈælɡəɹɪðm/" }],
  "meanings": [{ "partOfSpeech": "noun", "definitions": [{ "definition": "A collection of ordered steps that solve a mathematical problem." }] }]
}]
```

| Auth | CORS | Latency | Rate Limit | Use Case |
|------|------|---------|------------|----------|
| None | Yes | ~0.6s | Generous | `define_word` tool, language agents |

---

### 7. IP-API — IP Geolocation

```
GET http://ip-api.com/json/8.8.8.8
```

**Response:**
```json
{ "status": "success", "country": "United States", "city": "Ashburn", "lat": 39.03, "lon": -77.5, "timezone": "America/New_York", "isp": "Google LLC" }
```

| Auth | CORS | Latency | Rate Limit | Use Case |
|------|------|---------|------------|----------|
| None | **No** | ~0.4s | 45 req/min | IP lookup, user context |

> **Warning:** HTTP only (not HTTPS) on free tier. May be blocked by browsers (mixed content). Best for server-side use.

---

### 8. Random Joke API — Fun / Engagement

```
GET https://official-joke-api.appspot.com/random_joke
```

**Response:**
```json
{ "type": "general", "setup": "How do you check if a webpage is HTML5?", "punchline": "Try it out on Internet Explorer", "id": 99 }
```

| Auth | CORS | Latency | Rate Limit | Use Case |
|------|------|---------|------------|----------|
| None | Yes | ~0.5s | Generous | Chatbot personality, engagement |

---

## Search & Content APIs (9-11)

### 9. DuckDuckGo Instant Answer — Search / Quick Facts

```
GET https://api.duckduckgo.com/?q=OpenAI&format=json
```

**Response:**
```json
{
  "Heading": "OpenAI",
  "Abstract": "OpenAI is an American artificial intelligence research organization...",
  "Type": "A",
  "RelatedTopics": [{ "Text": "OpenAI An American AI research organization..." }]
}
```

| Auth | CORS | Latency | Rate Limit | Use Case |
|------|------|---------|------------|----------|
| None | Yes | ~0.2s | Generous | `search` tool, quick facts |

> **Limitation:** Instant Answer API only — returns Wikipedia-style summaries, not ranked search results. `Abstract` may be empty for many queries; check `RelatedTopics` as fallback.

---

### 10. Hacker News — Tech News Feed

```
GET https://hacker-news.firebaseio.com/v0/topstories.json     → [item IDs]
GET https://hacker-news.firebaseio.com/v0/item/{id}.json       → item detail
```

**Item detail:**
```json
{ "title": "Y Combinator", "by": "pg", "type": "story", "url": "http://ycombinator.com", "score": 57 }
```

| Auth | CORS | Latency | Rate Limit | Use Case |
|------|------|---------|------------|----------|
| None | Yes | ~0.5s | Generous | `get_news` tool, tech trends |

> Two-step: get IDs first, then fetch individual items.

---

### 11. ReadURL (readurl.b1122333.com) — Full Page Reading (Recommended)

```
POST https://readurl.b1122333.com/read-url
Headers: Content-Type: application/json
         x-api-key: <your-api-key>
Body: { "url": "https://en.wikipedia.org/wiki/Gemma_(language_model)" }
```

**Response:**
```json
{
  "url": "https://en.wikipedia.org/wiki/Gemma_(language_model)",
  "finalUrl": "https://en.wikipedia.org/wiki/Gemma_(language_model)",
  "title": "Gemma (language model)",
  "contentMarkdown": "From Wikipedia, the free encyclopedia\n\nGemma\n\nDeveloper: Google DeepMind...",
  "textExcerpt": "Gemma is a family of open-weight...",
  "meta": { "statusCode": 200, "loadTimeMs": 628, "fromCache": false }
}
```

| Auth | CORS | Latency | Rate Limit | Use Case |
|------|------|---------|------------|----------|
| API key required | Yes | ~0.4-0.6s | Generous | `read_url` tool — full page content extraction |

> **Best `read_url` option.** Uses headless browser (Puppeteer) for JS-rendered pages, extracts clean markdown via @mozilla/readability, optional screenshot. Returns full article content, not just metadata. Cached responses return in ~0.2s.

---

### 11b. Microlink — URL Metadata (Fallback)

```
GET https://api.microlink.io/?url=https://github.com
```

**Response:**
```json
{
  "status": "success",
  "data": { "title": "GitHub · Change is constant.", "description": "Join the world's most widely adopted...", "lang": "en" }
}
```

| Auth | CORS | Latency | Rate Limit | Use Case |
|------|------|---------|------------|----------|
| None | Yes | ~2.5s | **50 req/day** (free) | Link previews, metadata only |

> Returns title/description only (not full content). 50 req/day limit. Use ReadURL (#11) for full page reading.

---

## Computation & Data APIs (12-15)

### 12. Math.js — Mathematical Computation

```
GET https://api.mathjs.org/v4/?expr=2*(3%2B4)
```

**Response:** `14` (plain text)

Examples: `sqrt(144)` → 12, `15*37` → 555, `sin(pi/2)` → 1

| Auth | CORS | Latency | Rate Limit | Use Case |
|------|------|---------|------------|----------|
| None | Yes | ~1.5s | Generous | `calculate` tool |

> URL-encode `+` as `%2B`. Supports algebra, matrices, trigonometry, statistics.

---

### 13. Wikidata — Structured Knowledge Graph

```
GET https://www.wikidata.org/w/api.php?action=wbsearchentities&search=Singapore&language=en&format=json
```

**Response:**
```json
{ "search": [{ "id": "Q334", "label": "Singapore", "description": "sovereign island country and city-state in maritime Southeast Asia" }] }
```

| Auth | CORS | Latency | Rate Limit | Use Case |
|------|------|---------|------------|----------|
| None | Yes | ~0.4s | Generous | Entity lookup, structured knowledge |

> Complements Wikipedia's text summaries with structured entity data.

---

### 14. World Bank — Economic / Country Data

```
GET https://api.worldbank.org/v2/country/SGP/indicator/NY.GDP.MKTP.CD?format=json&per_page=3
```

**Response:**
```json
[{ "page": 1, "total": 65 }, [{ "date": "2024", "value": 547386645891.847, "country": { "value": "Singapore" } }]]
```

| Auth | CORS | Latency | Rate Limit | Use Case |
|------|------|---------|------------|----------|
| None | Yes | ~0.6s | Generous | Economic data, statistics |

> Thousands of indicators (GDP, population, health, education).

---

### 15. BigDataCloud — Reverse Geocoding

```
GET https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=1.29&longitude=103.85
```

**Response:**
```json
{ "city": "Singapore", "locality": "Singapore Riverside", "countryName": "Singapore", "countryCode": "SG" }
```

| Auth | CORS | Latency | Rate Limit | Use Case |
|------|------|---------|------------|----------|
| None | Yes | **~0.13s** (fastest) | Generous | Coordinates → city, reverse geocoding |

> Complementary to Nominatim (#5). Together they cover both directions.

---

## Finance & Commerce APIs (16, 23, 25)

### 16. CoinGecko — Crypto Prices

```
GET https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd
```

**Response:** `{ "bitcoin": { "usd": 69915 } }`

| Auth | CORS | Latency | Rate Limit | Use Case |
|------|------|---------|------------|----------|
| None | Yes | **~0.1s** | 10-30 req/min | `get_crypto_price` tool |

---

### 23. Open Exchange Rates — Currency Rates (Fast)

```
GET https://open.er-api.com/v6/latest/USD
```

**Response:**
```json
{ "base_code": "USD", "rates": { "SGD": 1.2796, "EUR": 0.8664, "JPY": 158.28 } }
```

| Auth | CORS | Latency | Rate Limit | Use Case |
|------|------|---------|------------|----------|
| None | Yes | **~0.13s** | Generous | `convert_currency` (faster than Frankfurter) |

> 6x faster than Frankfurter (0.13s vs 0.8s). Both use ECB data.

---

### 25. FakeStore API — E-commerce Simulation

```
GET https://fakestoreapi.com/products?limit=3
```

**Response:**
```json
[{ "id": 1, "title": "Fjallraven Backpack", "price": 109.95, "category": "men's clothing", "rating": { "rate": 3.9 } }]
```

| Auth | CORS | Latency | Rate Limit | Use Case |
|------|------|---------|------------|----------|
| None | Yes | ~0.5s | Generous | E-commerce testing, CRUD workflows |

> Supports GET/POST/PUT/DELETE on /products, /carts, /users.

---

## Knowledge & Research APIs (17, 20-22, 24)

### 17. Open Library — Book Search

```
GET https://openlibrary.org/search.json?q=harry+potter&limit=2
```

**Response:**
```json
{ "numFound": 3791, "docs": [{ "title": "Harry Potter and the Philosopher's Stone", "author_name": ["J. K. Rowling"], "first_publish_year": 1997 }] }
```

| Auth | CORS | Latency | Rate Limit | Use Case |
|------|------|---------|------------|----------|
| None | Yes | ~1.5s | Generous | `search_books` tool |

---

### 20. RestCountries — Country Intelligence

```
GET https://restcountries.com/v3.1/name/singapore
```

**Response:**
```json
[{ "name": { "common": "Singapore" }, "population": 6110200, "capital": ["Singapore"], "region": "Asia", "currencies": { "SGD": {} }, "languages": { "eng": "English", "zho": "Chinese" } }]
```

| Auth | CORS | Latency | Rate Limit | Use Case |
|------|------|---------|------------|----------|
| None | Yes | ~0.8s | Generous | `get_country` tool, travel agents |

---

### 21. StackExchange — Programming Q&A

```
GET https://api.stackexchange.com/2.3/search?order=desc&sort=activity&intitle=python&site=stackoverflow&pagesize=3
```

**Response:**
```json
{ "items": [{ "title": "How to...", "link": "https://stackoverflow.com/...", "score": 42 }], "has_more": true, "quota_remaining": 299 }
```

| Auth | CORS | Latency | Rate Limit | Use Case |
|------|------|---------|------------|----------|
| None | Yes | ~1.0s | 300 req/day (no key) | `search_code` tool, dev Q&A |

---

### 22. CrossRef — Academic Papers / Research

```
GET https://api.crossref.org/works?query=artificial+intelligence&rows=3
```

**Response:**
```json
{ "message": { "total-results": 1264411, "items": [{ "title": ["Defining Artificial Intelligence"], "DOI": "10.1007/..." }] } }
```

| Auth | CORS | Latency | Rate Limit | Use Case |
|------|------|---------|------------|----------|
| None | Yes | ~1.0s | Generous | `search_papers` tool, citations |

---

### 24. Open Food Facts — Food / Nutrition Data

```
GET https://world.openfoodfacts.org/api/v0/product/737628064502.json
```

**Response:**
```json
{ "product": { "product_name": "Thai peanut noodle kit", "brands": "Simply Asia", "nutriscore_grade": "d" } }
```

| Auth | CORS | Latency | Rate Limit | Use Case |
|------|------|---------|------------|----------|
| None | Yes | ~1.0s | Generous | `lookup_food` tool, barcode lookup |

---

## Testing & Development APIs (18-19)

### 18. RandomUser — Test Data Generator

```
GET https://randomuser.me/api/
```

**Response:**
```json
{ "results": [{ "name": { "first": "Andre", "last": "Rice" }, "email": "andre.rice@example.com", "location": { "country": "United Kingdom" } }] }
```

| Auth | CORS | Latency | Rate Limit | Use Case |
|------|------|---------|------------|----------|
| None | Yes | ~0.4s | Generous | Mock data, agent testing |

---

### 19. JSONPlaceholder — Fake REST Backend

```
GET https://jsonplaceholder.typicode.com/posts/1
```

**Response:**
```json
{ "userId": 1, "id": 1, "title": "sunt aut facere repellat provident...", "body": "quia et suscipit..." }
```

| Auth | CORS | Latency | Rate Limit | Use Case |
|------|------|---------|------------|----------|
| None | Yes | **~0.1s** | Unlimited | CRUD prototyping, workflow testing |

> Supports GET/POST/PUT/PATCH/DELETE on /posts, /comments, /users, /todos, /albums, /photos.

---

## Full Recommended Stack (25 APIs)

| Tool | API | Latency | Best For |
|------|-----|---------|----------|
| `get_time` | TimeAPI.io | 0.6s | Time/timezone queries |
| `get_weather` | Open-Meteo | 1.2s | Weather data |
| `search_knowledge` | Wikipedia | 0.2s | Facts, topic summaries |
| `search` | DuckDuckGo | 0.2s | Quick search/lookup |
| `convert_currency` | Frankfurter | 0.8s | Exchange rates |
| `convert_currency_fast` | open.er-api.com | 0.1s | Exchange rates (CDN) |
| `geocode` | Nominatim* | 0.4s | City → coordinates |
| `reverse_geocode` | BigDataCloud | 0.1s | Coordinates → city |
| `calculate` | Math.js | 1.5s | Math computation |
| `get_news` | Hacker News | 0.5s | Tech news |
| `read_url` | ReadURL (b1122333.com) | 0.4s | Full page content (recommended) |
| `read_url_fallback` | Microlink | 2.5s | URL metadata only (fallback) |
| `define_word` | Dictionary | 0.6s | Word definitions |
| `lookup_entity` | Wikidata | 0.4s | Structured entity data |
| `get_statistics` | World Bank | 0.6s | Economic data |
| `get_crypto_price` | CoinGecko | 0.1s | Crypto prices |
| `search_books` | Open Library | 1.5s | Book search |
| `get_country` | RestCountries | 0.8s | Country data |
| `search_code` | StackExchange | 1.0s | Programming Q&A |
| `search_papers` | CrossRef | 1.0s | Academic papers |
| `lookup_food` | Open Food Facts | 1.0s | Nutrition data |
| `mock_ecommerce` | FakeStore | 0.5s | E-commerce testing |
| `get_ip_info` | IP-API | 0.4s | IP geolocation (HTTP only) |
| `get_joke` | Joke API | 0.5s | Engagement |
| `generate_test_data` | RandomUser | 0.4s | Mock user data |
| `mock_api` | JSONPlaceholder | 0.1s | CRUD prototyping |

*Nominatim requires `User-Agent` header and has 1 req/s rate limit.

### Combining APIs

Weather by city name (two-step):
```
1. Nominatim: "Tokyo" → lat=35.6762, lon=139.6503
2. Open-Meteo: lat=35.6762&lon=139.6503 → 5.6°C
```

---

## Rejected APIs (Tested but Failed)

| API | HTTP | Reason |
|-----|------|--------|
| WorldTimeAPI | Connection reset | Server unreachable |
| Time.now | 404 | URL does not exist (fabricated) |
| Advice API | 200 (4.5s) | Too slow for agent tools |
| LinkPreview | 403 | Requires API key |
| OCR.space | 403 | Requires API key |
| Piston (code execution) | 401 | Public API closed 2026-02-15 |
| Clawdia Search | 502 | Bad Gateway — server down |
| Clawdia Scraper | 502 | Bad Gateway — server down |
| Clawdia Screenshot | Timeout | Connection timeout |
| Clawdia Code Runner | 502 | Bad Gateway — server down |
| Public APIs Directory | Connection refused | Server unreachable |
| CoinCap | Connection refused | Server unreachable |
| apicagent | 308 loop | Redirect loop, no data |

---

## Usage in This Project

The `tools_demo.html` and `gemma_client/chat.html` pages use registered tools that can call these APIs:

```javascript
registry.add({
  name: 'get_weather',
  description: 'Get current weather for a location',
  parameters: {
    latitude:  { type: 'number', required: true },
    longitude: { type: 'number', required: true }
  },
  handler: async (args) => {
    const res = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${args.latitude}&longitude=${args.longitude}&current_weather=true`
    );
    return (await res.json()).current_weather;
  }
});

registry.add({
  name: 'get_time',
  description: 'Get current time in a timezone',
  parameters: {
    timezone: { type: 'string', required: true, description: 'IANA timezone e.g. Asia/Singapore' }
  },
  handler: async (args) => {
    const res = await fetch(
      `https://timeapi.io/api/Time/current/zone?timeZone=${encodeURIComponent(args.timezone)}`
    );
    return await res.json();
  }
});

registry.add({
  name: 'search',
  description: 'Search for information about a topic',
  parameters: {
    query: { type: 'string', required: true }
  },
  handler: async (args) => {
    const res = await fetch(
      `https://api.duckduckgo.com/?q=${encodeURIComponent(args.query)}&format=json`
    );
    const data = await res.json();
    return { heading: data.Heading, abstract: data.Abstract,
      related: (data.RelatedTopics || []).slice(0, 5).map(t => t.Text).filter(Boolean) };
  }
});

registry.add({
  name: 'calculate',
  description: 'Evaluate a mathematical expression',
  parameters: {
    expression: { type: 'string', required: true, description: 'e.g. sqrt(144), 15*37' }
  },
  handler: async (args) => {
    const res = await fetch(
      `https://api.mathjs.org/v4/?expr=${encodeURIComponent(args.expression)}`
    );
    return { expression: args.expression, result: await res.text() };
  }
});

registry.add({
  name: 'read_url',
  description: 'Read a web page and extract its content as markdown',
  parameters: {
    url: { type: 'string', required: true, description: 'Full URL to read' }
  },
  handler: async (args) => {
    const res = await fetch('https://readurl.b1122333.com/read-url', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': 'YOUR_READURL_API_KEY'
      },
      body: JSON.stringify({ url: args.url })
    });
    const data = await res.json();
    return { title: data.title, content: data.contentMarkdown, loadTimeMs: data.meta?.loadTimeMs };
  }
});
```

> All tool handlers should include error handling in production. See [gemma_client docs](gemma-client.md) for the full ToolRegistry API.
