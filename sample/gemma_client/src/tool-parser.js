// ============================================================
//  tool-parser.js — XML tool call parsing and prompt building
//  Parses <tool_call> blocks from model responses
// ============================================================

const TOOL_CALL_REGEX = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g;

// --- JSON parsing with recovery ---

function tryParseJSON(raw) {
    // Progressive JSON recovery: raw → fences → commas → quotes → keys → extract
    try { return JSON.parse(raw); } catch { /* fallthrough: try cleanup */ }

    let s = raw.trim();

    // Strip markdown code fences
    s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
    try { return JSON.parse(s); } catch { /* fallthrough */ }

    // Fix trailing commas
    s = s.replace(/,\s*([}\]])/g, '$1');
    try { return JSON.parse(s); } catch { /* fallthrough */ }

    // Fix single quotes → double quotes
    if (s.includes("'") && !/"/.test(s.replace(/\\"/g, ''))) {
        s = s.replace(/'/g, '"');
        try { return JSON.parse(s); } catch { /* fallthrough */ }
    }

    // Fix unquoted keys
    s = s.replace(/([{,])\s*(\w+)\s*:/g, '$1"$2":');
    try { return JSON.parse(s); } catch { /* fallthrough */ }

    // Extract JSON object substring
    const match = s.match(/\{[\s\S]*\}/);
    if (match) {
        try { return JSON.parse(match[0]); } catch { /* all strategies exhausted */ }
    }

    return null;
}

// --- Parse tool calls from model response ---

export function parseToolCalls(text) {
    const calls = [];
    let match;
    const regex = new RegExp(TOOL_CALL_REGEX.source, TOOL_CALL_REGEX.flags);
    while ((match = regex.exec(text)) !== null) {
        const parsed = tryParseJSON(match[1]);
        if (parsed && typeof parsed.name === 'string') {
            calls.push({
                name: parsed.name,
                arguments: parsed.arguments || parsed.args || parsed.parameters || {}
            });
        }
    }
    return calls;
}

// --- Check if response contains tool calls ---

export function hasToolCalls(text) {
    return /<tool_call>/.test(text);
}

// --- Strip tool call blocks from response text ---

export function stripToolCalls(text) {
    return text.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '').trim();
}

// --- Build system prompt with tool definitions ---

function buildToolBlock(tool) {
    let block = `**${tool.name}**\n`;
    block += `Description: ${tool.description}\n`;
    block += 'Parameters:\n';
    const params = tool.parameters || {};
    for (const [pName, pDef] of Object.entries(params)) {
        const req = pDef.required ? 'required' : 'optional';
        let line = `  - ${pName} (${pDef.type || 'string'}, ${req}): ${pDef.description || ''}`;
        if (pDef.default !== undefined) line += ` Default: ${JSON.stringify(pDef.default)}`;
        if (pDef.enum) line += ` Enum: [${pDef.enum.map(e => JSON.stringify(e)).join(', ')}]`;
        block += line + '\n';
    }
    return block;
}

export function buildSystemPrompt(tools) {
    const toolBlocks = tools.map((t, i) => `${i + 1}. ${buildToolBlock(t)}`).join('\n');
    return `You are a helpful assistant with access to the following tools. When you need to use a tool to answer the user's question, respond with a JSON function call wrapped in <tool_call> tags.

Available tools:

${toolBlocks}
To call a tool, output EXACTLY this format:
<tool_call>
{"name": "function_name", "arguments": {"param1": "value1"}}
</tool_call>

You may call multiple tools by including multiple <tool_call> blocks.
After receiving tool results, use them to provide your final answer.
If no tool is needed, respond normally without <tool_call> tags.
Do NOT make up data — only use actual tool results.`;
}
