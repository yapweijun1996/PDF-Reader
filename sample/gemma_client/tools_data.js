// ============================================================
//  tools_data.js — External data API tools (11 tools)
//  Called by registerTools() in chat_tools.js
// ============================================================

function registerDataTools(registry) {
    const _svc = (typeof GemmaClient !== 'undefined' && GemmaClient.HarnessConfig) ? GemmaClient.HarnessConfig.services : null;

    // --- Time via TimeAPI.io ---
    registry.add({
        name: 'get_time',
        description: 'Get the current real-time date and time for a specific IANA timezone using TimeAPI.io. Returns accurate server time.',
        parameters: { timezone: { type: 'string', required: true, description: 'IANA timezone, e.g. "Asia/Tokyo", "America/New_York", "Asia/Kuala_Lumpur"' } },
        handler: async (args) => {
            const res = await fetch(`${_svc?.data?.timeApi || 'https://timeapi.io/api/time/current/zone'}?timeZone=${encodeURIComponent(args.timezone)}`);
            if (!res.ok) throw new Error(`TimeAPI error: ${res.status}`);
            const d = await res.json();
            return { timezone: d.timeZone, datetime: d.dateTime, date: d.date, time: d.time, day_of_week: d.dayOfWeek, year: d.year, month: d.month, day: d.day, hour: d.hour, minute: d.minute, seconds: d.seconds, dst_active: d.dstActive };
        }
    });

    // --- World Time ---
    registry.add({
        name: 'world_time',
        description: 'Get real-time current time for multiple major cities/timezones around the world via TimeAPI.io.',
        parameters: { zones: { type: 'string', required: false, default: 'major', description: '"major" for key cities, or comma-separated IANA timezones' } },
        handler: async (args) => {
            const major = ['Pacific/Auckland','Australia/Sydney','Asia/Tokyo','Asia/Shanghai','Asia/Kuala_Lumpur','Asia/Kolkata','Asia/Dubai','Europe/Moscow','Europe/Berlin','Europe/London','America/Sao_Paulo','America/New_York','America/Chicago','America/Denver','America/Los_Angeles'];
            let zones = major;
            if (args.zones && args.zones !== 'major') zones = args.zones.split(',').map(s => s.trim());
            const results = [];
            for (const tz of zones) {
                try { const res = await fetch(`${_svc?.data?.timeApi || 'https://timeapi.io/api/time/current/zone'}?timeZone=${encodeURIComponent(tz)}`); if (res.ok) { const d = await res.json(); results.push({timezone:d.timeZone,time:d.time,date:d.date,day:d.dayOfWeek}); } else results.push({timezone:tz,error:'Failed: '+res.status}); }
                catch(e) { results.push({timezone:tz,error:e.message}); }
            }
            return { queried_at: new Date().toISOString(), zone_count: results.length, results };
        }
    });

    // --- Weather via Open-Meteo + Nominatim ---
    registry.add({
        name: 'get_weather',
        description: 'Get real-time current weather for a city using Open-Meteo API (free, no key). First geocodes the city, then fetches weather.',
        parameters: {
            city: { type: 'string', required: true, description: 'City name, e.g. "Tokyo", "Kuala Lumpur"' },
            unit: { type: 'string', required: false, default: 'celsius', enum: ['celsius','fahrenheit'] }
        },
        handler: async (args) => {
            const geoRes = await fetch(`${_svc?.data?.nominatim || 'https://nominatim.openstreetmap.org/search'}?q=${encodeURIComponent(args.city)}&format=json&limit=1`);
            const geoData = await geoRes.json();
            if (!geoData.length) throw new Error('City not found: ' + args.city);
            const { lat, lon, display_name } = geoData[0];
            const tempUnit = args.unit === 'fahrenheit' ? 'fahrenheit' : 'celsius';
            const res = await fetch(`${_svc?.data?.openMeteo || 'https://api.open-meteo.com/v1/forecast'}?latitude=${lat}&longitude=${lon}&current_weather=true&temperature_unit=${tempUnit}&windspeed_unit=kmh`);
            if (!res.ok) throw new Error('Open-Meteo error: ' + res.status);
            const data = await res.json();
            const cw = data.current_weather;
            const wmoCodes = {0:'Clear sky',1:'Mainly clear',2:'Partly cloudy',3:'Overcast',45:'Fog',48:'Rime fog',51:'Light drizzle',53:'Drizzle',55:'Dense drizzle',61:'Slight rain',63:'Moderate rain',65:'Heavy rain',71:'Slight snow',73:'Moderate snow',75:'Heavy snow',80:'Slight showers',81:'Moderate showers',82:'Violent showers',95:'Thunderstorm',96:'Thunderstorm w/ hail',99:'Thunderstorm w/ heavy hail'};
            return { city: args.city, location: display_name, latitude: lat, longitude: lon, temperature: cw.temperature, unit: tempUnit, windspeed: cw.windspeed + ' km/h', wind_direction: cw.winddirection + '°', condition: wmoCodes[cw.weathercode] || 'Code ' + cw.weathercode, weather_code: cw.weathercode, observation_time: cw.time };
        }
    });

    // --- Currency via Frankfurter ---
    registry.add({
        name: 'exchange_rate',
        description: 'Convert currency using Frankfurter API (free, no key). Supports USD, EUR, GBP, JPY, SGD, MYR, CNY, AUD, etc.',
        parameters: {
            amount: { type: 'number', required: true, description: 'Amount to convert' },
            from: { type: 'string', required: true, description: 'Source currency code, e.g. "USD"' },
            to: { type: 'string', required: true, description: 'Target currency code, e.g. "MYR"' }
        },
        handler: async (args) => {
            const res = await fetch(`${_svc?.data?.frankfurter || 'https://api.frankfurter.app/latest'}?amount=${args.amount}&from=${args.from.toUpperCase()}&to=${args.to.toUpperCase()}`);
            if (!res.ok) throw new Error('Frankfurter API error: ' + res.status);
            const data = await res.json();
            const convertedAmount = data.rates[args.to.toUpperCase()];
            const baseAmount = Number(data.amount) || 1;
            return {
                amount: data.amount,
                from: data.base,
                to: args.to.toUpperCase(),
                converted_amount: convertedAmount,
                rate: convertedAmount / baseAmount,
                date: data.date
            };
        }
    });

    // --- CoinGecko (crypto prices) ---
    registry.add({
        name: 'crypto_price',
        description: 'Get real-time cryptocurrency prices from CoinGecko. Supports bitcoin, ethereum, solana, dogecoin, and 10000+ coins.',
        parameters: {
            coins: { type: 'string', required: true, description: 'Comma-separated coin IDs, e.g. "bitcoin,ethereum,solana"' },
            currency: { type: 'string', required: false, default: 'usd', description: 'Target currency, e.g. "usd", "eur", "myr"' }
        },
        handler: async (args) => {
            const cur = args.currency || 'usd';
            const res = await fetch(`${_svc?.data?.coinGecko || 'https://api.coingecko.com/api/v3/simple/price'}?ids=${encodeURIComponent(args.coins)}&vs_currencies=${cur}&include_24hr_change=true`);
            if (!res.ok) throw new Error('CoinGecko error: ' + res.status);
            const data = await res.json();
            const prices = {};
            for (const [coin, info] of Object.entries(data)) {
                prices[coin] = { price: info[cur], change_24h: info[cur + '_24h_change'] ? Math.round(info[cur + '_24h_change'] * 100) / 100 + '%' : null };
            }
            return { currency: cur, prices };
        }
    });

    // --- RestCountries ---
    registry.add({
        name: 'country_info',
        description: 'Get detailed information about a country: population, capital, languages, currencies, region, area, timezones, and more.',
        parameters: { name: { type: 'string', required: true, description: 'Country name, e.g. "Malaysia", "Japan", "Singapore"' } },
        handler: async (args) => {
            const res = await fetch(`${_svc?.data?.restCountries || 'https://restcountries.com/v3.1/name/'}${encodeURIComponent(args.name)}?fields=name,capital,population,region,subregion,languages,currencies,area,timezones,flags,borders`);
            if (!res.ok) throw new Error('RestCountries error: ' + res.status);
            const data = await res.json();
            const c = data[0];
            return { name: c.name?.common, official_name: c.name?.official, capital: c.capital, population: c.population, region: c.region, subregion: c.subregion, languages: c.languages, currencies: c.currencies, area_km2: c.area, timezones: c.timezones, flag: c.flags?.png, borders: c.borders };
        }
    });

    // --- World Bank (economic data) ---
    registry.add({
        name: 'country_stats',
        description: 'Get economic statistics for a country from the World Bank. Supports GDP, population, and thousands of indicators. Country code is ISO 3-letter (e.g. MYS, SGP, USA, JPN).',
        parameters: {
            country: { type: 'string', required: true, description: 'ISO 3-letter country code, e.g. "MYS", "SGP", "USA"' },
            indicator: { type: 'string', required: false, default: 'NY.GDP.MKTP.CD', description: 'World Bank indicator code. Common: NY.GDP.MKTP.CD (GDP), SP.POP.TOTL (population), SL.UEM.TOTL.ZS (unemployment)' }
        },
        handler: async (args) => {
            const ind = args.indicator || 'NY.GDP.MKTP.CD';
            const res = await fetch(`${_svc?.data?.worldBank || 'https://api.worldbank.org/v2/country/'}${args.country}/indicator/${ind}?format=json&per_page=5`);
            if (!res.ok) throw new Error('World Bank error: ' + res.status);
            const data = await res.json();
            if (!data[1]) throw new Error('No data found for ' + args.country);
            return { country: args.country, indicator: ind, data: data[1].map(d => ({ year: d.date, value: d.value })).filter(d => d.value !== null) };
        }
    });

    // --- Hacker News (top stories) ---
    registry.add({
        name: 'tech_news',
        description: 'Get the latest top stories from Hacker News (Y Combinator). Returns current trending tech news with titles, URLs, and scores.',
        parameters: { count: { type: 'number', required: false, default: 5, description: 'Number of stories (1-10)' } },
        handler: async (args) => {
            const n = Math.min(Math.max(args.count || 5, 1), 10);
            const idsRes = await fetch(`${_svc?.data?.hackerNews || 'https://hacker-news.firebaseio.com/v0'}/topstories.json`);
            const ids = await idsRes.json();
            const stories = [];
            for (const id of ids.slice(0, n)) {
                const res = await fetch(`${_svc?.data?.hackerNews || 'https://hacker-news.firebaseio.com/v0'}/item/${id}.json`);
                const item = await res.json();
                if (item) stories.push({ title: item.title, url: item.url || `https://news.ycombinator.com/item?id=${item.id}`, score: item.score, by: item.by, comments: item.descendants || 0 });
            }
            return { source: 'Hacker News', count: stories.length, stories };
        }
    });

    // --- IP Geolocation ---
    registry.add({
        name: 'my_ip',
        description: 'Get the user\'s public IP address and geolocation (country, city, timezone, ISP).',
        parameters: {},
        handler: async () => {
            const res = await fetch(`${_svc?.data?.ipApi || 'https://ipwho.is/'}?fields=ip,success,message,country,country_code,region,city,postal,latitude,longitude,timezone,connection`);
            if (!res.ok) throw new Error('IP API error: ' + res.status);
            const data = await res.json();
            if (data.success === false) throw new Error(data.message || 'IP lookup failed');
            return {
                ip: data.ip,
                country: data.country,
                country_code: data.country_code,
                region: data.region,
                city: data.city,
                zip: data.postal,
                latitude: data.latitude,
                longitude: data.longitude,
                timezone: data.timezone?.id || data.timezone,
                isp: data.connection?.isp || '',
                org: data.connection?.org || ''
            };
        }
    });

    // --- Geocode via Nominatim ---
    registry.add({
        name: 'geocode',
        description: 'Convert a place name or address to coordinates (lat/lon). Uses OpenStreetMap Nominatim.',
        parameters: { query: { type: 'string', required: true, description: 'Place name or address' } },
        handler: async (args) => {
            const res = await fetch(`${_svc?.data?.nominatim || 'https://nominatim.openstreetmap.org/search'}?q=${encodeURIComponent(args.query)}&format=json&limit=3&addressdetails=1`);
            if (!res.ok) throw new Error('Nominatim error: ' + res.status);
            const data = await res.json();
            if (!data.length) throw new Error('Location not found: ' + args.query);
            return { query: args.query, results: data.map(r => ({ name: r.display_name, latitude: r.lat, longitude: r.lon, type: r.type, country: r.address?.country || '', state: r.address?.state || '' })) };
        }
    });

    // --- BigDataCloud (reverse geocode) ---
    registry.add({
        name: 'reverse_geocode',
        description: 'Convert coordinates (latitude/longitude) to a city, country, and address. Complementary to the geocode tool which does the opposite.',
        parameters: {
            latitude: { type: 'number', required: true, description: 'Latitude, e.g. 3.1579' },
            longitude: { type: 'number', required: true, description: 'Longitude, e.g. 101.7112' }
        },
        handler: async (args) => {
            const res = await fetch(`${_svc?.data?.bigDataCloud || 'https://api.bigdatacloud.net/data/reverse-geocode-client'}?latitude=${args.latitude}&longitude=${args.longitude}&localityLanguage=en`);
            if (!res.ok) throw new Error('BigDataCloud error: ' + res.status);
            const d = await res.json();
            return { latitude: args.latitude, longitude: args.longitude, city: d.city, locality: d.locality, country: d.countryName, country_code: d.countryCode, continent: d.continent, principalSubdivision: d.principalSubdivision };
        }
    });
}
