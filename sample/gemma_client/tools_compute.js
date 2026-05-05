// ============================================================
//  tools_compute.js — Local compute & utility tools (10 tools)
//  Called by registerTools() in chat_tools.js
// ============================================================

function registerComputeTools(registry) {
    const _svc = (typeof GemmaClient !== 'undefined' && GemmaClient.HarnessConfig) ? GemmaClient.HarnessConfig.services : null;

    // --- Calculator ---
    registry.add({
        name: 'calculate',
        description: 'Evaluate a mathematical expression and return the numeric result. Supports +, -, *, /, (), %.',
        parameters: { expression: { type: 'string', required: true, description: 'Math expression, e.g. "(15 * 23) + 100"' } },
        handler: async (args) => {
            const expr = args.expression.replace(/[^0-9+\-*/().%\s]/g, '');
            if (!expr) throw new Error('Invalid expression');
            return { expression: args.expression, result: Function('"use strict"; return (' + expr + ')')() };
        }
    });

    // --- Math.js (advanced calculator) ---
    registry.add({
        name: 'math',
        description: 'Evaluate advanced mathematical expressions using Math.js API. Supports algebra, trigonometry (sin, cos, tan), logarithms, square roots, matrices, and more. Use this for complex math; use "calculate" for simple arithmetic.',
        parameters: { expression: { type: 'string', required: true, description: 'Math expression, e.g. "sqrt(144)", "sin(pi/2)", "log(1000, 10)", "2^10"' } },
        handler: async (args) => {
            const res = await fetch(`${_svc?.language?.mathJs || 'https://api.mathjs.org/v4/'}?expr=${encodeURIComponent(args.expression)}`);
            if (!res.ok) throw new Error('Math.js error: ' + res.status);
            const result = await res.text();
            return { expression: args.expression, result };
        }
    });

    // --- Unit converter ---
    registry.add({
        name: 'convert_units',
        description: 'Convert between common units (length, weight, temperature, data size)',
        parameters: {
            value: { type: 'number', required: true, description: 'The numeric value to convert' },
            from: { type: 'string', required: true, description: 'Source unit, e.g. "km", "lb", "celsius", "GB"' },
            to: { type: 'string', required: true, description: 'Target unit, e.g. "miles", "kg", "fahrenheit", "MB"' }
        },
        handler: async (args) => {
            const conversions = { 'km_miles':0.621371,'miles_km':1.60934,'kg_lb':2.20462,'lb_kg':0.453592,'cm_inch':0.393701,'inch_cm':2.54,'m_ft':3.28084,'ft_m':0.3048,'l_gallon':0.264172,'gallon_l':3.78541,'gb_mb':1024,'mb_gb':1/1024,'tb_gb':1024,'gb_tb':1/1024,'kb_mb':1/1024,'mb_kb':1024 };
            const f = args.from.toLowerCase(), t = args.to.toLowerCase();
            if (f==='celsius'&&t==='fahrenheit') return {value:args.value,from:args.from,to:args.to,result:Math.round((args.value*9/5+32)*100)/100};
            if (f==='fahrenheit'&&t==='celsius') return {value:args.value,from:args.from,to:args.to,result:Math.round(((args.value-32)*5/9)*100)/100};
            if (f==='celsius'&&t==='kelvin') return {value:args.value,from:args.from,to:args.to,result:Math.round((args.value+273.15)*100)/100};
            if (f==='kelvin'&&t==='celsius') return {value:args.value,from:args.from,to:args.to,result:Math.round((args.value-273.15)*100)/100};
            const key = f+'_'+t;
            if (conversions[key]) return {value:args.value,from:args.from,to:args.to,result:Math.round(args.value*conversions[key]*10000)/10000};
            throw new Error(`Unsupported conversion: ${args.from} → ${args.to}`);
        }
    });

    // --- Date calculator ---
    registry.add({
        name: 'date_calc',
        description: 'Calculate date differences or add/subtract days from a date',
        parameters: {
            operation: { type: 'string', required: true, description: '"diff" or "add"', enum: ['diff','add'] },
            date1: { type: 'string', required: true, description: 'Date in YYYY-MM-DD format, or "today"' },
            date2: { type: 'string', required: false, description: 'Second date (for diff) or days to add (for add)' }
        },
        handler: async (args) => {
            const p = (s) => s === 'today' ? new Date() : new Date(s);
            if (args.operation === 'diff') { const d1=p(args.date1),d2=p(args.date2),days=Math.floor(Math.abs(d2-d1)/86400000); return {date1:d1.toISOString().slice(0,10),date2:d2.toISOString().slice(0,10),difference_days:days,difference_weeks:Math.round(days/7*10)/10}; }
            else { const d=p(args.date1); d.setDate(d.getDate()+(parseInt(args.date2)||0)); return {original_date:args.date1,days_added:parseInt(args.date2)||0,result_date:d.toISOString().slice(0,10),day_of_week:d.toLocaleDateString('en-US',{weekday:'long'})}; }
        }
    });

    // --- Base64 ---
    registry.add({ name: 'base64', description: 'Encode or decode a Base64 string', parameters: { operation:{type:'string',required:true,enum:['encode','decode']}, text:{type:'string',required:true} },
        handler: async (args) => args.operation==='encode' ? {operation:'encode',result:btoa(unescape(encodeURIComponent(args.text)))} : {operation:'decode',result:decodeURIComponent(escape(atob(args.text)))}
    });

    // --- Hash ---
    registry.add({
        name: 'hash',
        description: 'Generate SHA-256/384/512 hash of text',
        parameters: { text:{type:'string',required:true}, algorithm:{type:'string',required:false,default:'SHA-256',enum:['SHA-256','SHA-384','SHA-512']} },
        handler: async (args) => {
            const algo=args.algorithm||'SHA-256', buf=await crypto.subtle.digest(algo,new TextEncoder().encode(args.text));
            return {algorithm:algo,hash:Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('')};
        }
    });

    // --- Random ---
    registry.add({ name: 'random', description: 'Generate random numbers, UUIDs, or passwords', parameters: { type:{type:'string',required:true,enum:['number','uuid','password']}, min:{type:'number',required:false,default:1}, max:{type:'number',required:false,default:100}, length:{type:'number',required:false,default:16} },
        handler: async (args) => {
            if (args.type==='number') { const mn=args.min??1,mx=args.max??100; return {type:'number',result:Math.floor(Math.random()*(mx-mn+1))+mn}; }
            if (args.type==='uuid') return {type:'uuid',result:crypto.randomUUID()};
            const c='abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*',l=args.length||16; let pw=''; for(let i=0;i<l;i++)pw+=c[Math.floor(Math.random()*c.length)]; return {type:'password',length:l,result:pw};
        }
    });

    // --- JSON formatter ---
    registry.add({ name: 'format_json', description: 'Validate and format/pretty-print a JSON string', parameters: { json_string: { type: 'string', required: true } },
        handler: async (args) => { try { const p=JSON.parse(args.json_string); return {valid:true,formatted:JSON.stringify(p,null,2),type:Array.isArray(p)?'array':typeof p}; } catch(e) { return {valid:false,error:e.message}; } }
    });

    // --- String tool ---
    registry.add({
        name: 'string_tool',
        description: 'String operations: word_count, char_count, reverse, uppercase, lowercase, extract_emails, extract_urls, slug',
        parameters: { operation:{type:'string',required:true,enum:['word_count','char_count','reverse','uppercase','lowercase','extract_emails','extract_urls','slug']}, text:{type:'string',required:true} },
        handler: async (args) => {
            const t=args.text;
            switch(args.operation) {
                case 'word_count': return {result:t.trim().split(/\s+/).filter(Boolean).length};
                case 'char_count': return {total:t.length,no_spaces:t.replace(/\s/g,'').length};
                case 'reverse': return {result:t.split('').reverse().join('')};
                case 'uppercase': return {result:t.toUpperCase()};
                case 'lowercase': return {result:t.toLowerCase()};
                case 'extract_emails': return {result:t.match(/[\w.+-]+@[\w-]+\.[\w.-]+/g)||[]};
                case 'extract_urls': return {result:t.match(/https?:\/\/[^\s<>"{}|\\^`[\]]+/g)||[]};
                case 'slug': return {result:t.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')};
                default: throw new Error('Unknown: '+args.operation);
            }
        }
    });

    // --- Color converter ---
    registry.add({
        name: 'color_convert',
        description: 'Convert colors between HEX, RGB, and HSL formats',
        parameters: { color:{type:'string',required:true,description:'e.g. "#ff5733" or "rgb(255,87,51)"'} },
        handler: async (args) => {
            let r,g,b; const c=args.color.trim();
            if (c.startsWith('#')) { const h=c.slice(1); r=parseInt(h.substring(0,2),16);g=parseInt(h.substring(2,4),16);b=parseInt(h.substring(4,6),16); }
            else if (c.startsWith('rgb')) { [r,g,b]=c.match(/\d+/g).map(Number); }
            else throw new Error('Provide HEX or RGB format');
            const hex='#'+[r,g,b].map(v=>v.toString(16).padStart(2,'0')).join('');
            const rn=r/255,gn=g/255,bn=b/255,mx=Math.max(rn,gn,bn),mn=Math.min(rn,gn,bn),l=(mx+mn)/2;
            let h=0,s=0; if(mx!==mn){const d=mx-mn;s=l>0.5?d/(2-mx-mn):d/(mx+mn);if(mx===rn)h=((gn-bn)/d+(gn<bn?6:0))/6;else if(mx===gn)h=((bn-rn)/d+2)/6;else h=((rn-gn)/d+4)/6;}
            return {input:args.color,hex,rgb:`rgb(${r},${g},${b})`,hsl:`hsl(${Math.round(h*360)},${Math.round(s*100)}%,${Math.round(l*100)}%)`,r,g,b};
        }
    });
}
