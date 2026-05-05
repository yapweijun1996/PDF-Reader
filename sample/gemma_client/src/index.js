// ============================================================
//  gemma_client — Entry point
//  npm run build → dist/gemma_client.js
//
//  Usage in browser:
//    <script src="gemma_client.js"></script>
//    const client = new GemmaClient.GemmaAPI({ ... });
// ============================================================

export { encryptKey, decryptKey, KeyManager, sleep, fetchWithRetry } from './core.js';
export { GemmaAPI } from './client.js';
export { ToolRegistry, ToolRunner, parseToolCalls, hasToolCalls, stripToolCalls } from './tools.js';
export { OODAERunner, PHASE } from './oodae.js';
export { SkillRegistry, registerDefaultSkills } from './skill-registry.js';
export { HarnessConfig } from './config.js';
export { GoalManager, GOAL_STATUS, SUBGOAL_STATUS } from './goal-manager.js';
export { ModelRouter, MODEL_TIER } from './model-router.js';
export { ProactiveEngine, TRIGGER_TYPE, TRIGGER_STATUS, APPROVAL_STATUS } from './proactive.js';
export { LearningSystem } from './learning.js';
export { SearchAgent } from './search-agent.js';
export { parseAgentsMd, buildAgentsPromptBlock, loadAgentsMd, hasAgentsConfig, isSiteDomainQuery, isPrivateInfoQuery, getAgentsDefaultLanguage, buildNoKnowledgeFallback, registerKnowledgeKeywords } from './agents-config.js';
export { KnowledgeRetriever, cosineSimilarity } from './knowledge-retriever.js';
export { extractKnowledgeFact } from './knowledge-fact-extractor.js';
