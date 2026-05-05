// ============================================================
//  oodae-plan-post.js — Plan post-processing (multi-intent enrichment)
//  Detects entities the DECIDE plan missed and adds supplementary tool calls
// ============================================================

import { HarnessConfig } from './config.js';

// ===== Multi-intent harness: detect entities Decide's plan missed =====
export function _enrichPlanForMissedIntents(planOrCtx, observation, orientation, userText) {
    // ── COODAE: duck-type — ctx passes itself as first arg ──
    const isCtx        = planOrCtx && typeof planOrCtx === 'object' && 'userText' in planOrCtx;
    const plan         = isCtx ? planOrCtx.plan : planOrCtx;
    const _observation = isCtx ? planOrCtx : observation;
    const _orientation = isCtx ? planOrCtx : orientation;
    const _userText    = isCtx ? planOrCtx.userText : userText;

    if (!plan || !plan.plan || plan.plan.length === 0) return plan;

    // ── Use CLASSIFY's search_entities (model-filtered) if available, otherwise fall back ──
    const searchEntities = _observation._searchEntities || _observation.key_entities || [];
    if (searchEntities.length < 2) return plan;

    // Only consider entities that appear in the USER'S OWN text
    const userLower = (_userText || '').toLowerCase();
    const userEntities = searchEntities.filter(e => {
        const eLower = String(e).toLowerCase();
        if (eLower.length < 4) return false;
        return userLower.includes(eLower.slice(0, Math.min(eLower.length, HarnessConfig.truncation.entityMatchPrefix)));
    });
    if (userEntities.length < 2) return plan;

    // What does Decide's plan already cover?
    const planStr = JSON.stringify(plan.plan).toLowerCase();
    const plannedTools = new Set(plan.plan.map(s => s.tool));

    // Find uncovered user entities
    const uncovered = [];
    for (const entity of userEntities) {
        const eLower = String(entity).toLowerCase();
        if (planStr.includes(eLower.slice(0, Math.min(eLower.length, HarnessConfig.truncation.entityMatchLong)))) continue;
        uncovered.push(entity);
    }
    if (uncovered.length === 0) return plan;

    // Match uncovered entities to registered tools by name overlap
    const tools = this.registry?.list() || [];
    for (const entity of uncovered) {
        const eWords = String(entity).toLowerCase().split(/\s+/).filter(w => w.length > 2);
        let matched = false;

        for (const tool of tools) {
            if (plannedTools.has(tool.name)) continue;
            const toolWords = tool.name.split('_').filter(w => w.length > 2);
            const overlap = eWords.some(ew => toolWords.some(tw => tw.includes(ew) || ew.includes(tw)));
            if (!overlap) continue;

            const args = {};
            for (const [pName] of Object.entries(tool.parameters || {})) {
                if (pName === 'timezone') args[pName] = _orientation.timezone || 'UTC';
                else if (pName === 'location' || pName === 'city') args[pName] = searchEntities.find(e => e !== entity) || entity;
                else if (pName === 'query') args[pName] = searchEntities.filter(e => e !== entity).concat(entity).join(' ');
            }
            plan.plan.push({ tool: tool.name, args, reason: `multi-intent: ${entity}` });
            plannedTools.add(tool.name);
            matched = true;
            break;
        }

        // Fallback: web_search with entity + conversation context
        if (!matched && !plannedTools.has('web_search_' + entity)) {
            const contextEntity = searchEntities.find(e => e !== entity && String(e).length > 3);
            const query = contextEntity ? `${contextEntity} ${entity}` : entity;
            plan.plan.push({ tool: 'web_search', args: { query }, reason: `multi-intent: ${entity}` });
        }
    }

    if (isCtx) planOrCtx.plan = plan;
    return plan;
}
