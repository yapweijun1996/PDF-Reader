// ============================================================
//  tools.js — Re-export barrel for tool subsystem
//
//  Modules:
//    tool-parser.js   — XML tool call parsing, JSON recovery
//    tool-registry.js — Tool definition storage and execution
//    tool-runner.js   — Agentic tool-calling loop (legacy)
// ============================================================

export { parseToolCalls, hasToolCalls, stripToolCalls } from './tool-parser.js';
export { ToolRegistry } from './tool-registry.js';
export { ToolRunner } from './tool-runner.js';
