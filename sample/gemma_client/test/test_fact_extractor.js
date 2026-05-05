// ============================================================
//  test/test_fact_extractor.js — Unit tests for
//  src/knowledge-fact-extractor.js
// ============================================================

import { extractKnowledgeFact } from '../src/knowledge-fact-extractor.js';
import { assertEqual, assertTrue, assertFalse, group, results, resetResults, summarize } from './helpers.js';

// Mock search_knowledge results matching real chunk format
const PROFILE_CHUNKS = [
    {
        id: 'profile-004', source: 'knowledge/profile.md',
        title: 'Profile > Online Presence', score: 0.85,
        text: '- Personal website: yapweijun1996.com\n- GitHub: github.com/yapweijun1996\n- CodePen: codepen.io/yapweijun1996\n- Professional focus: browser-native tools, local-first AI workflows, frontend utilities, and lightweight web applications',
    },
    {
        id: 'profile-003', source: 'knowledge/profile.md',
        title: 'Profile > Location', score: 0.72,
        text: 'Based in Singapore.',
    },
    {
        id: 'profile-001', source: 'knowledge/profile.md',
        title: 'Profile > About Yap Wei Jun', score: 0.68,
        text: 'Yap Wei Jun is a Singapore-based software engineer building browser-native tools and local-first AI workflows.',
    },
];

const CONTACT_CHUNKS = [
    {
        id: 'contact-001', source: 'knowledge/contact.md',
        title: 'Contact > How to Reach Yap Wei Jun', score: 0.90,
        text: '- Website: yapweijun1996.com\n- GitHub: github.com/yapweijun1996\n- CodePen: codepen.io/yapweijun1996\n- Location: Singapore',
    },
    {
        id: 'contact-002', source: 'knowledge/contact.md',
        title: 'Contact > Professional Inquiries', score: 0.75,
        text: 'For project collaborations, technical consulting, or business inquiries, please reach out through the contact form on yapweijun1996.com.',
    },
];

const PROJECT_CHUNKS = [
    {
        id: 'projects-003', source: 'knowledge/projects.md',
        title: 'Projects > ScreenClip Pro', score: 0.88,
        text: 'The public repository `yapweijun1996/Screen-Recorder-React-JS-Frontend` describes ScreenClip Pro as a browser-side screen recorder and editor. It can capture a display, trim the result, and export MP4 entirely on the client using React, Vite, and FFmpeg.wasm.',
    },
    {
        id: 'projects-002', source: 'knowledge/projects.md',
        title: 'Projects > PayNow QR Generator', score: 0.70,
        text: 'The public GitHub repository `yapweijun1996/PayNow-QR-Generator` describes a web application that generates PayNow QR codes from payment details such as UEN, amount, expiry date, reference number, and company name.',
    },
];

export async function run() {
    resetResults();
    console.log('\n🔍 test_fact_extractor.js');

    // ── GitHub profile extraction ──
    group('extractKnowledgeFact — GitHub');

    const github = extractKnowledgeFact("What is Yap Wei Jun's GitHub?", PROFILE_CHUNKS);
    assertTrue(github !== null, 'GitHub fact extracted');
    assertEqual(github.factType, 'github_profile', 'factType is github_profile');
    assertTrue(github.answer.includes('github.com/yapweijun1996'), 'answer contains GitHub URL');

    const github2 = extractKnowledgeFact('What is his GitHub?', PROFILE_CHUNKS);
    assertTrue(github2 !== null, '"his GitHub" also extracts');
    assertTrue(github2.answer.includes('github.com/yapweijun1996'), '"his GitHub" answer has URL');

    const githubZh = extractKnowledgeFact("What is Yap Wei Jun's GitHub?", PROFILE_CHUNKS, { language: 'mandarin' });
    assertTrue(githubZh !== null, 'GitHub fact in Mandarin');
    assertTrue(githubZh.answer.includes('github.com/yapweijun1996'), 'Mandarin answer has URL');
    assertTrue(githubZh.answer.includes('GitHub'), 'Mandarin answer mentions GitHub');

    // ── CodePen profile extraction ──
    group('extractKnowledgeFact — CodePen');

    const codepen = extractKnowledgeFact('Does he have a CodePen profile?', PROFILE_CHUNKS);
    assertTrue(codepen !== null, 'CodePen fact extracted');
    assertEqual(codepen.factType, 'codepen_profile', 'factType is codepen_profile');
    assertTrue(codepen.answer.includes('codepen.io/yapweijun1996'), 'answer contains CodePen URL');

    // ── Website URL extraction ──
    group('extractKnowledgeFact — Website');

    const website = extractKnowledgeFact('What is his website?', PROFILE_CHUNKS);
    assertTrue(website !== null, 'website fact extracted');
    assertEqual(website.factType, 'website_url', 'factType is website_url');
    assertTrue(website.answer.includes('yapweijun1996.com'), 'answer contains website URL');

    // ── Location extraction ──
    group('extractKnowledgeFact — Location');

    const location = extractKnowledgeFact('Where is he based?', PROFILE_CHUNKS);
    assertTrue(location !== null, 'location fact extracted');
    assertEqual(location.factType, 'location', 'factType is location');
    assertTrue(location.answer.includes('Singapore'), 'answer contains Singapore');

    // ── Contact route extraction ──
    group('extractKnowledgeFact — Contact');

    const contact = extractKnowledgeFact('How can I contact him?', CONTACT_CHUNKS);
    assertTrue(contact !== null, 'contact fact extracted');
    assertEqual(contact.factType, 'contact_route', 'factType is contact_route');
    assertTrue(contact.answer.includes('yapweijun1996.com'), 'contact includes website');
    assertTrue(contact.answer.includes('github.com'), 'contact includes GitHub');

    // ── Project description extraction ──
    group('extractKnowledgeFact — Project (ScreenClip Pro)');

    const screenclip = extractKnowledgeFact('What is ScreenClip Pro?', PROJECT_CHUNKS);
    assertTrue(screenclip !== null, 'ScreenClip Pro fact extracted');
    assertEqual(screenclip.factType, 'project_description', 'factType is project_description');
    assertTrue(screenclip.answer.includes('screen recorder'), 'answer describes screen recorder');
    assertTrue(screenclip.answer.includes('browser-side'), 'answer mentions browser-side');

    const paynow = extractKnowledgeFact('Tell me about PayNow QR Generator', PROJECT_CHUNKS);
    assertTrue(paynow !== null, 'PayNow QR Generator fact extracted');
    assertEqual(paynow.factType, 'project_description', 'factType is project_description');
    assertTrue(paynow.answer.includes('PayNow QR'), 'answer mentions PayNow QR');

    // ── No match → null ──
    group('extractKnowledgeFact — no match');

    const noMatch = extractKnowledgeFact('What is the weather in Tokyo?', PROFILE_CHUNKS);
    assertEqual(noMatch, null, 'unrelated question → null');

    const empty = extractKnowledgeFact('What is his GitHub?', []);
    assertEqual(empty, null, 'empty results → null');

    const nullQ = extractKnowledgeFact(null, PROFILE_CHUNKS);
    assertEqual(nullQ, null, 'null query → null');

    const nullR = extractKnowledgeFact('What is his GitHub?', null);
    assertEqual(nullR, null, 'null results → null');

    // ── Language variants ──
    group('extractKnowledgeFact — language');

    const enLoc = extractKnowledgeFact('Where is he based?', PROFILE_CHUNKS, { language: 'english' });
    assertTrue(enLoc.answer.includes('based in'), 'English location uses "based in"');

    const zhLoc = extractKnowledgeFact('Where is he based?', PROFILE_CHUNKS, { language: 'mandarin' });
    assertTrue(zhLoc.answer.includes('位于'), 'Mandarin location uses 位于');
    assertTrue(zhLoc.answer.includes('Singapore'), 'Mandarin location keeps proper noun');

    // ═══════════════════════════════════════════════════
    // FALSE-POSITIVE PREVENTION — validation gating
    // ═══════════════════════════════════════════════════

    group('extractKnowledgeFact — false positive: vague GitHub mention');

    // Chunks that mention "GitHub" but do NOT contain an actual GitHub URL
    const VAGUE_CHUNKS = [
        {
            id: 'faq-008', source: 'knowledge/faq.md',
            title: 'FAQ > How can I contact Yap Wei Jun?', score: 0.75,
            text: 'Use yapweijun1996.com for public contact and inquiry routes. Public profiles also include GitHub and CodePen.',
        },
        {
            id: 'faq-001', source: 'knowledge/faq.md',
            title: 'FAQ > Who is Yap Wei Jun?', score: 0.65,
            text: 'Yap Wei Jun is a Singapore-based software engineer building browser-native tools and local-first AI workflows.',
        },
    ];

    const vagueGithub = extractKnowledgeFact("What is Yap Wei Jun's GitHub?", VAGUE_CHUNKS);
    assertEqual(vagueGithub, null, 'vague "GitHub and CodePen" mention → null (not "and")');

    const vagueCodepen = extractKnowledgeFact('Does he have a CodePen profile?', VAGUE_CHUNKS);
    assertEqual(vagueCodepen, null, 'vague "GitHub and CodePen" mention → null for CodePen too');

    group('extractKnowledgeFact — false positive: partial/garbage values');

    const GARBAGE_CHUNKS = [
        {
            id: 'test-001', source: 'test.md',
            title: 'Test', score: 0.80,
            text: 'Check out his GitHub for more details about the project.',
        },
    ];

    const garbageGithub = extractKnowledgeFact('What is his GitHub?', GARBAGE_CHUNKS);
    assertEqual(garbageGithub, null, '"GitHub for more" does not produce valid URL');

    group('extractKnowledgeFact — valid extraction still works after tightening');

    // Re-verify that valid chunks still extract correctly
    const validGithub = extractKnowledgeFact("What is Yap Wei Jun's GitHub?", PROFILE_CHUNKS);
    assertTrue(validGithub !== null, 'valid GitHub chunk still extracts');
    assertTrue(validGithub.answer.includes('github.com/yapweijun1996'), 'valid GitHub URL still returned');
    assertFalse(validGithub.answer.includes(' and'), 'answer does not contain " and"');

    const validCodepen = extractKnowledgeFact('Does he have a CodePen profile?', PROFILE_CHUNKS);
    assertTrue(validCodepen !== null, 'valid CodePen chunk still extracts');
    assertTrue(validCodepen.answer.includes('codepen.io/yapweijun1996'), 'valid CodePen URL still returned');

    const validWebsite = extractKnowledgeFact('What is his website?', PROFILE_CHUNKS);
    assertTrue(validWebsite !== null, 'valid website chunk still extracts');
    assertTrue(validWebsite.answer.includes('yapweijun1996.com'), 'valid website URL still returned');

    group('extractKnowledgeFact — location validation');

    const LOCATION_GARBAGE = [
        {
            id: 'test-002', source: 'test.md',
            title: 'Test', score: 0.80,
            text: 'The company is based in and around the city center.',
        },
    ];
    const garbageLoc = extractKnowledgeFact('Where is he based?', LOCATION_GARBAGE);
    assertEqual(garbageLoc, null, '"based in and around" does not produce valid location');

    return summarize();
}
