// ============================================================
//  skill-registry.js — Named multi-step skill templates
//  Skills are pre-defined workflows that DECIDE can invoke.
//  The orchestrator expands skills into concrete tool plans.
// ============================================================

export class SkillRegistry {
    constructor() {
        this._skills = new Map();
    }

    add(definition) {
        if (!definition.name) throw new Error('Skill must have a name');
        if (!definition.steps && !definition.planner) {
            throw new Error('Skill must have steps (array) or planner (function)');
        }
        this._skills.set(definition.name, {
            name: definition.name,
            description: definition.description || '',
            parameters: definition.parameters || {},
            steps: definition.steps || null,
            planner: definition.planner || null
        });
    }

    remove(name) {
        return this._skills.delete(name);
    }

    get(name) {
        return this._skills.get(name);
    }

    has(name) {
        return this._skills.has(name);
    }

    list() {
        return Array.from(this._skills.values()).map(s => ({
            name: s.name,
            description: s.description,
            parameters: s.parameters
        }));
    }

    get size() {
        return this._skills.size;
    }

    // Expand a skill into a concrete tool plan
    expand(name, args) {
        const skill = this._skills.get(name);
        if (!skill) return [];

        // Dynamic planner: function that generates steps based on args
        if (skill.planner) {
            return skill.planner(args);
        }

        // Static steps: template with $variable substitution
        return (skill.steps || []).map(step => ({
            tool: step.tool,
            args: this._resolveArgs(step.args, args),
            reason: step.reason || `skill:${name}`
        }));
    }

    // Replace $variable references in template args with actual values
    _resolveArgs(templateArgs, userArgs) {
        const resolved = {};
        for (const [k, v] of Object.entries(templateArgs || {})) {
            if (typeof v === 'string' && v.includes('$')) {
                resolved[k] = v.replace(/\$(\w+)/g, (_, varName) =>
                    userArgs[varName] !== undefined ? userArgs[varName] : `$${varName}`
                );
            } else {
                resolved[k] = v;
            }
        }
        return resolved;
    }
}

// ===== Built-in skill definitions =====

export function registerDefaultSkills(skillRegistry, toolRegistry) {
    // Deep research: multi-angle search on a topic
    skillRegistry.add({
        name: 'deep_research',
        description: 'Deep research on a topic — searches from multiple angles, fetches key pages',
        parameters: {
            topic: { type: 'string', required: true },
            angles: { type: 'string', required: false, description: 'comma-separated search angles' }
        },
        planner: (args) => {
            const topic = args.topic || 'unknown';
            const angles = args.angles
                ? args.angles.split(',').map(a => a.trim())
                : ['overview', 'latest news', 'analysis'];
            return angles.map(angle => ({
                tool: 'web_search',
                args: { query: `${topic} ${angle}` },
                reason: `deep_research: ${angle}`
            }));
        }
    });

    // Compare: parallel research on two subjects for comparison
    skillRegistry.add({
        name: 'compare',
        description: 'Compare two subjects — parallel searches for side-by-side analysis',
        parameters: {
            subject_a: { type: 'string', required: true },
            subject_b: { type: 'string', required: true },
            aspect: { type: 'string', required: false, description: 'what to compare (e.g. stock, revenue)' }
        },
        planner: (args) => {
            const aspect = args.aspect || '';
            return [
                { tool: 'web_search', args: { query: `${args.subject_a} ${aspect}`.trim() }, reason: `compare: ${args.subject_a}` },
                { tool: 'web_search', args: { query: `${args.subject_b} ${aspect}`.trim() }, reason: `compare: ${args.subject_b}` },
            ];
        }
    });

    // Daily briefing: time + weather + news in parallel
    if (toolRegistry?.has('get_time') && toolRegistry?.has('get_weather')) {
        skillRegistry.add({
            name: 'daily_briefing',
            description: 'Daily briefing — time, weather, and top news in parallel',
            parameters: {
                city: { type: 'string', required: false, default: 'Kuala Lumpur' },
                timezone: { type: 'string', required: false, default: 'UTC' }
            },
            planner: (args) => {
                const steps = [
                    { tool: 'get_time', args: { timezone: args.timezone || 'UTC' }, reason: 'daily_briefing: time' },
                ];
                if (args.city) {
                    steps.push({ tool: 'get_weather', args: { city: args.city || 'Kuala Lumpur' }, reason: 'daily_briefing: weather' });
                }
                steps.push({ tool: 'tech_news', args: { topic: 'AI' }, reason: 'daily_briefing: news' });
                return steps;
            }
        });
    }
}
