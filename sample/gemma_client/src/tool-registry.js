// ============================================================
//  tool-registry.js — Tool definition storage and execution
// ============================================================

export class ToolRegistry {
    constructor() {
        this._tools = new Map();
    }

    static FX_CURRENCY_ALIASES = {
        usd: 'USD',
        'us dollar': 'USD',
        'us dollars': 'USD',
        dollar: 'USD',
        dollars: 'USD',
        美元: 'USD',
        eur: 'EUR',
        euro: 'EUR',
        euros: 'EUR',
        欧元: 'EUR',
        gbp: 'GBP',
        pound: 'GBP',
        pounds: 'GBP',
        英镑: 'GBP',
        jpy: 'JPY',
        yen: 'JPY',
        日元: 'JPY',
        sgd: 'SGD',
        'singapore dollar': 'SGD',
        'singapore dollars': 'SGD',
        新币: 'SGD',
        新元: 'SGD',
        新加坡元: 'SGD',
        myr: 'MYR',
        ringgit: 'MYR',
        'malaysian ringgit': 'MYR',
        马币: 'MYR',
        令吉: 'MYR',
        cny: 'CNY',
        rmb: 'CNY',
        yuan: 'CNY',
        人民币: 'CNY',
        aud: 'AUD',
        澳元: 'AUD'
    };

    _normalizeCurrencyCode(value) {
        if (value === undefined || value === null) return value;
        const normalized = String(value).trim().toLowerCase().replace(/\.$/, '').replace(/\s+/g, ' ');
        if (!normalized) return value;
        const alias = ToolRegistry.FX_CURRENCY_ALIASES[normalized];
        if (alias) return alias;
        const code = normalized.toUpperCase();
        return /^[A-Z]{3}$/.test(code) ? code : value;
    }

    _pairsToObject(entries) {
        const out = {};
        if (!Array.isArray(entries)) return out;
        for (const item of entries) {
            if (!item || typeof item !== 'object') continue;
            const key = item.argument_name || item.name || item.key || item.param;
            const value = item.argument_value ?? item.value ?? item.val;
            if (key) out[key] = value;
        }
        return out;
    }

    _normalizeArgs(name, args) {
        if (!args || typeof args !== 'object' || Array.isArray(args)) return {};

        let normalized = { ...args };
        for (const wrapper of ['arguments', 'parameters', 'params']) {
            const wrapped = normalized[wrapper];
            if (!wrapped) continue;
            const unpacked = Array.isArray(wrapped)
                ? this._pairsToObject(wrapped)
                : (typeof wrapped === 'object' ? wrapped : {});
            delete normalized[wrapper];
            normalized = { ...unpacked, ...normalized };
        }

        if (name === 'exchange_rate') {
            if (normalized.from === undefined && normalized.from_currency !== undefined) normalized.from = normalized.from_currency;
            if (normalized.from === undefined && normalized.source_currency !== undefined) normalized.from = normalized.source_currency;
            if (normalized.to === undefined && normalized.to_currency !== undefined) normalized.to = normalized.to_currency;
            if (normalized.to === undefined && normalized.target_currency !== undefined) normalized.to = normalized.target_currency;
            if (normalized.amount === undefined && normalized.value !== undefined) normalized.amount = normalized.value;
            if (normalized.amount === undefined && normalized.quantity !== undefined) normalized.amount = normalized.quantity;
            normalized.from = this._normalizeCurrencyCode(normalized.from);
            normalized.to = this._normalizeCurrencyCode(normalized.to);
        }

        if (name === 'geocode' && normalized.query === undefined) {
            normalized.query = normalized.place ?? normalized.address ?? normalized.location ?? normalized.city ?? normalized.name ?? normalized.search;
        }

        return normalized;
    }

    add(definition) {
        if (!definition.name) throw new Error('Tool must have a name');
        if (!definition.handler || typeof definition.handler !== 'function') {
            throw new Error('Tool must have a handler function');
        }
        this._tools.set(definition.name, {
            name: definition.name,
            description: definition.description || '',
            parameters: definition.parameters || {},
            handler: definition.handler
        });
    }

    remove(name) {
        return this._tools.delete(name);
    }

    clear() {
        this._tools.clear();
    }

    get(name) {
        return this._tools.get(name);
    }

    has(name) {
        return this._tools.has(name);
    }

    list() {
        return Array.from(this._tools.values()).map(t => ({
            name: t.name,
            description: t.description,
            parameters: t.parameters
        }));
    }

    get size() {
        return this._tools.size;
    }

    async execute(name, args) {
        const tool = this._tools.get(name);
        if (!tool) return { error: `Unknown tool: ${name}` };
        try {
            args = this._normalizeArgs(name, args);
            for (const [pName, pDef] of Object.entries(tool.parameters)) {
                if (pDef.required && (args[pName] === undefined || args[pName] === null)) {
                    return { error: `Missing required parameter '${pName}' for tool '${name}'` };
                }
                if (pDef.type === 'number' && typeof args[pName] === 'string') {
                    const n = Number(args[pName].replace(/,/g, '').trim());
                    if (!Number.isNaN(n)) args[pName] = n;
                }
                if (pDef.default !== undefined && args[pName] === undefined) {
                    args[pName] = pDef.default;
                }
            }
            const result = await tool.handler(args);
            return { result };
        } catch (err) {
            return { error: `Tool '${name}' failed: ${err.message}` };
        }
    }
}
