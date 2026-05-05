// ============================================================
//  cot-standard.js — Standardized Chain-of-Thought
//  Single source of truth for OODAE thinking instructions.
// ============================================================

export function quoteForPrompt(value) {
    return JSON.stringify(String(value ?? ''));
}

export function buildStructuredInputBlock(label, data) {
    const payload = data === undefined ? null : data;
    return `BEGIN ${label}
${JSON.stringify(payload, null, 2)}
END ${label}`;
}

/**
 * Build a standardized Chain-of-Thought instruction block.
 *
 * This is intentionally a prompt fragment. The caller should provide the
 * task context above it and the explicit output schema below it.
 */
export function buildCOT(taskDescription, opts = {}) {
    const keyQuestions = opts.keyQuestions || [];
    const maxSteps = opts.maxSteps ?? 10;
    const successNote = opts.successNote || 'Give a clear final answer.';

    const questionsBlock = keyQuestions.length > 0
        ? `\nKey components to address:\n${keyQuestions.map((q, i) => `${i + 1}. ${q}`).join('\n')}\n`
        : '';

    return `Iterative Chain-of-Thought Reasoning
Think step by step inside <thinking> tags and explain your reasoning clearly.
Do not place the final answer inside <thinking> tags.
Constraint: step <= ${maxSteps}

Problem:
${taskDescription}${questionsBlock}
I need you to use your full attention on this task.
By using thinking loop:
- Restate end user query with correct understanding.
- Deep thinking with a Chain of Thought limited to a maximum of ${maxSteps} branches.
- Keep focus on context.
- Perform step-by-step analysis.
- Perform step-by-step reflection.
- Perform step-by-step refactoring.
- If it does not meet the user's query, repeat the loop and try again.
Finalize and deliver to the end user: ${successNote}`;
}

export const COT = {
    observe() {
        return buildCOT('Classify the current user message.', {
            keyQuestions: [
                'What is the user actually asking or saying?',
                'Is this greeting, question, command, information sharing, or follow-up?',
                'Does this require real-time data or tools?',
                'What named entities appear in the current message only?',
                'Is it self-contained or dependent on recent context?'
            ],
            successNote: 'Output ONLY the JSON classification object.'
        });
    },

    classify() {
        return buildCOT('Verify and correct the structured classification.', {
            keyQuestions: [
                'Are the intent flags mutually consistent?',
                'Are user entities limited to the current message?',
                'Is this a back-reference to earlier context?',
                'Is this save / recall / neither for memory?',
                'Is it a factual lookup or a task/generation request?'
            ],
            successNote: 'Output ONLY the corrected JSON classification object.'
        });
    },

    decide(hasPreviousAttempts = false) {
        return buildCOT('Choose the minimum effective tool plan for the current user need.', {
            keyQuestions: [
                'What exact information or action does the user need?',
                'Which tool or tools directly satisfy that need?',
                'What is the shortest high-signal query or argument set?',
                hasPreviousAttempts
                    ? 'What different angle should be tried because previous attempts already failed?'
                    : 'Is parallel execution actually necessary, or is one tool enough?',
                'Does the plan answer only the current question and avoid unnecessary tools?'
            ],
            successNote: 'Output ONLY the JSON tool plan.'
        });
    },

    evaluate() {
        return buildCOT('Judge whether the gathered results answer the user correctly.', {
            keyQuestions: [
                'What exact entity, fact, or request is being evaluated?',
                'Do the results match that exact entity rather than a similar one?',
                'Is the answer explicit in the evidence or only inferred?',
                'Are there tangential or wrong-entity results that should be ignored?',
                'Is the evidence sufficient, and what confidence level is justified?'
            ],
            successNote: 'Output ONLY the required evaluation JSON.'
        });
    },

    direct(language = 'english') {
        return buildCOT('Write a direct reply without tools.', {
            keyQuestions: [
                'What is the user asking or saying right now?',
                'What relevant profile or recent-chat context is actually useful?',
                'What is the most helpful direct reply?',
                `Is the final answer written in exactly one language (${language})?`
            ],
            successNote: `Write the final answer naturally in ${language} only.`
        });
    },

    forceAnswer() {
        return buildCOT('Write the best final answer from incomplete or mixed tool evidence.', {
            keyQuestions: [
                'What was the original user question?',
                'What evidence from the tools is actually usable?',
                'What can be stated confidently versus uncertainly?',
                'What is the most honest helpful final answer?'
            ],
            successNote: 'Write the best final user-facing answer now.'
        });
    },

    goalDecompose(maxSubgoals = 8) {
        return buildCOT('Break a complex goal into the minimum useful ordered sub-goals.', {
            keyQuestions: [
                'What distinct information needs or actions are required?',
                'Which sub-goals are independent and can run in parallel?',
                'Which sub-goals depend on earlier results?',
                'What is the minimum non-redundant set of sub-goals?',
                `How can this stay within the maximum of ${maxSubgoals} sub-goals?`
            ],
            successNote: 'Output ONLY the sub-goal JSON.'
        });
    },

    goalReplan() {
        return buildCOT('Propose an alternative approach for a failed sub-goal.', {
            keyQuestions: [
                'Why did the sub-goal fail?',
                'Can the same information be obtained another way?',
                'Should the sub-goal be rephrased, retried, or abandoned?'
            ],
            successNote: 'Output ONLY the retry decision JSON.'
        });
    },

    goalSynthesize(language = 'english') {
        return buildCOT('Combine multiple completed sub-goal results into one final answer.', {
            keyQuestions: [
                'What key information did each sub-goal produce?',
                'How do the results relate to each other?',
                'What structure best answers the original goal?',
                `Is the final answer complete and clearly written in ${language}?`
            ],
            successNote: `Write the final synthesized answer in ${language}.`
        });
    },

    subagentDecompose() {
        return buildCOT('Split a multi-part request into independent parallelizable sub-tasks only when justified.', {
            keyQuestions: [
                'How many distinct questions are actually present?',
                'Are they truly independent or just one question about multiple entities?',
                'Would splitting improve answer quality, or add unnecessary overhead?'
            ],
            successNote: 'Output ONLY the subtask JSON or null.'
        });
    },

    subagentSynthesize(language = 'english') {
        return buildCOT('Answer the full original question by combining sub-task results.', {
            keyQuestions: [
                'What did each sub-task establish?',
                'Are any results contradictory or incomplete?',
                'How should the final answer be organized so every sub-task is covered?',
                `Is the final answer complete and written in ${language}?`
            ],
            successNote: `Write the final combined answer in ${language}.`
        });
    },

    searchPlan() {
        return buildCOT('Generate the best search queries for the current user need.', {
            keyQuestions: [
                'What new information does the user want?',
                'What part of the context is the true search target versus just background?',
                'Which language and keywords maximize search quality?',
                'What primary and backup queries best cover the target?'
            ],
            successNote: 'Output ONLY the JSON search plan.'
        });
    },

    searchRefine() {
        return buildCOT('Refine a failed search strategy into one better query.', {
            keyQuestions: [
                'Why did the earlier queries fail?',
                'What keywords, language, or angle should change?',
                'What single replacement query best targets the user need now?'
            ],
            successNote: 'Output ONLY the improved query string.'
        });
    },

    micro(decision, outputNote = 'Output ONLY the required JSON.') {
        return buildCOT(decision, { successNote: outputNote });
    }
};
