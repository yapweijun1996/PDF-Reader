#!/usr/bin/env node
// ============================================================
//  test/run_all.js — Test runner
//  Usage: node test/run_all.js [--unit] [--live] [--all]
// ============================================================

const C = { reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m', red: '\x1b[31m', green: '\x1b[32m', cyan: '\x1b[36m', yellow: '\x1b[33m' };

const args = process.argv.slice(2);
const runUnit = args.includes('--unit') || args.includes('--all') || args.length === 0;
const runLive = args.includes('--live') || args.includes('--all') || args.length === 0;
const runRegression = args.includes('--regression') || args.includes('--e2e');
const runComplex = args.includes('--complex') || args.includes('--route2');
const runLongconv = args.includes('--longconv') || args.includes('--long');
const runStress = args.includes('--stress') || args.includes('--boundary');
const runAbility = args.includes('--ability') || args.includes('--complex-ability');

const UNIT_TESTS = ['test_core.js', 'test_client.js', 'test_tools.js', 'test_oodae_unit.js', 'test_helpers_unit.js', 'test_micro.js', 'test_search_agent.js', 'test_search_tools_browser.js', 'test_chat_context.js', 'test_cot_standard.js', 'test_agents_config.js', 'test_knowledge_retriever.js', 'test_fact_extractor.js'];
const LIVE_TESTS = ['test_oodae_live.js'];
const REGRESSION_TESTS = ['test_regression.js'];
const COMPLEX_TESTS = ['test_complex.js'];
const LONGCONV_TESTS = ['test_longconv.js'];
const STRESS_TESTS = ['test_stress.js'];
const ABILITY_TESTS = ['test_complex_ability.js'];

const totals = { unit: { total: 0, passed: 0, failed: 0 }, live: { total: 0, passed: 0, failed: 0 }, regression: { total: 0, passed: 0, failed: 0 }, complex: { total: 0, passed: 0, failed: 0 }, longconv: { total: 0, passed: 0, failed: 0 }, stress: { total: 0, passed: 0, failed: 0 }, ability: { total: 0, passed: 0, failed: 0 } };

async function runFile(file, category) {
    try {
        const mod = await import(`./${file}`);
        const result = await mod.run();
        totals[category].total += result.total;
        totals[category].passed += result.passed;
        totals[category].failed += result.failed;
    } catch (err) {
        console.log(`${C.red}${C.bold}ERROR loading ${file}: ${err.message}${C.reset}`);
        totals[category].total++; totals[category].failed++;
    }
}

console.log(`\n${C.cyan}${C.bold}╔═══════════════════════════════════════╗${C.reset}`);
console.log(`${C.cyan}${C.bold}║   GemmaClient Test Suite              ║${C.reset}`);
console.log(`${C.cyan}${C.bold}╚═══════════════════════════════════════╝${C.reset}`);
console.log(`${C.dim}  Mode: ${runStress ? 'stress / capability boundary' : runLongconv ? 'long conversation' : runComplex ? 'complex (route 2)' : runRegression ? 'regression' : runUnit && runLive ? 'all' : runUnit ? 'unit only' : 'live only'}${C.reset}`);

const t0 = Date.now();

if (runUnit) {
    console.log(`\n${C.yellow}${C.bold}── UNIT TESTS ──${C.reset}`);
    for (const f of UNIT_TESTS) await runFile(f, 'unit');
}

if (runLive && !runRegression) {
    console.log(`\n${C.yellow}${C.bold}── LIVE TESTS ──${C.reset}`);
    for (const f of LIVE_TESTS) await runFile(f, 'live');
}

if (runRegression) {
    console.log(`\n${C.yellow}${C.bold}── REGRESSION TESTS (E2E) ──${C.reset}`);
    for (const f of REGRESSION_TESTS) await runFile(f, 'regression');
}

if (runComplex) {
    console.log(`\n${C.yellow}${C.bold}── COMPLEX SCENARIO TESTS (Route 2) ──${C.reset}`);
    for (const f of COMPLEX_TESTS) await runFile(f, 'complex');
}

if (runLongconv) {
    console.log(`\n${C.yellow}${C.bold}── LONG CONVERSATION TESTS ──${C.reset}`);
    for (const f of LONGCONV_TESTS) await runFile(f, 'longconv');
}

if (runStress) {
    console.log(`\n${C.yellow}${C.bold}── STRESS / CAPABILITY BOUNDARY TESTS ──${C.reset}`);
    for (const f of STRESS_TESTS) await runFile(f, 'stress');
}

if (runAbility) {
    console.log(`\n${C.yellow}${C.bold}── COMPLEX LLM ABILITY TESTS ──${C.reset}`);
    for (const f of ABILITY_TESTS) await runFile(f, 'ability');
}

const elapsed = ((Date.now() - t0) / 1000).toFixed(2);
const allTotal = totals.unit.total + totals.live.total + totals.regression.total + totals.complex.total + totals.longconv.total + totals.stress.total + totals.ability.total;
const allPassed = totals.unit.passed + totals.live.passed + totals.regression.passed + totals.complex.passed + totals.longconv.passed + totals.stress.passed + totals.ability.passed;
const allFailed = totals.unit.failed + totals.live.failed + totals.regression.failed + totals.complex.failed + totals.longconv.failed + totals.stress.failed + totals.ability.failed;
const color = allFailed > 0 ? C.red : C.green;

console.log(`\n${'═'.repeat(45)}`);
if (runUnit) console.log(`  UNIT: ${C.bold}${totals.unit.passed}/${totals.unit.total} passed${totals.unit.failed > 0 ? `${C.red}, ${totals.unit.failed} failed` : ''}${C.reset}`);
if (runLive && !runRegression) console.log(`  LIVE: ${C.bold}${totals.live.passed}/${totals.live.total} passed${totals.live.failed > 0 ? `${C.red}, ${totals.live.failed} failed` : ''}${C.reset}`);
if (runRegression) console.log(`  E2E:  ${C.bold}${totals.regression.passed}/${totals.regression.total} passed${totals.regression.failed > 0 ? `${C.red}, ${totals.regression.failed} failed` : ''}${C.reset}`);
if (runComplex) console.log(`  COMPLEX: ${C.bold}${totals.complex.passed}/${totals.complex.total} passed${totals.complex.failed > 0 ? `${C.red}, ${totals.complex.failed} failed` : ''}${C.reset}`);
if (runLongconv) console.log(`  LONGCONV: ${C.bold}${totals.longconv.passed}/${totals.longconv.total} passed${totals.longconv.failed > 0 ? `${C.red}, ${totals.longconv.failed} failed` : ''}${C.reset}`);
if (runStress) console.log(`  STRESS: ${C.bold}${totals.stress.passed}/${totals.stress.total} passed${totals.stress.failed > 0 ? `${C.red}, ${totals.stress.failed} failed` : ''}${C.reset}`);
if (runAbility) console.log(`  ABILITY: ${C.bold}${totals.ability.passed}/${totals.ability.total} passed${totals.ability.failed > 0 ? `${C.red}, ${totals.ability.failed} failed` : ''}${C.reset}`);
console.log(`  ${color}${C.bold}TOTAL: ${allPassed}/${allTotal} passed${allFailed > 0 ? `, ${allFailed} failed` : ''}${C.reset}`);
console.log(`  ${C.dim}${elapsed}s${C.reset}`);
console.log('═'.repeat(45));

process.exit(allFailed > 0 ? 1 : 0);
