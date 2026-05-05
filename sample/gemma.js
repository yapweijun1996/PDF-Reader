// ============================================================
//  API Key Rotation + XOR Decryption
//  Keys in gemma_code.jsonl are stored as XOR-encrypted strings.
//  Use encryptKey("YOUR_API_KEY", XOR_SEED) in browser console
//  to generate encrypted keys for the .jsonl file.
// ============================================================

var apiKeys = [];
var currentKeyIndex = 0;
var keyUseCount = 0;
var ROTATE_EVERY_N = 5; // proactively rotate key every N uses

// The XOR seed used when encrypting the keys
var XOR_SEED = "20250710";

const _encoder = new TextEncoder();
const _decoder = new TextDecoder();

/**
 * Encrypt a plaintext string with the given KEY.
 * Use this in the browser console to generate values for gemma_code.jsonl:
 *   encryptKey("AIzaSy...", XOR_SEED)
 */
function encryptKey(message, KEY) {
    let ciphertext = '';
    const encodedMessage = _encoder.encode(message);
    for (let i = 0; i < encodedMessage.length; i++) {
        let charCode = encodedMessage[i];
        let keyChar = KEY.charCodeAt(i % KEY.length);
        let encryptedChar = charCode ^ keyChar;
        let numValue = encryptedChar.toString().padStart(3, '0');
        ciphertext += numValue;
    }
    return ciphertext;
}

/**
 * Decrypt an encrypted key string back to the original API key.
 */
function decryptKey(ciphertext, KEY) {
    let decodedMessage = '';
    for (let i = 0; i < ciphertext.length; i += 3) {
        let numStr = ciphertext.slice(i, i + 3);
        let encryptedChar = parseInt(numStr);
        let keyChar = KEY.charCodeAt((i / 3) % KEY.length);
        let decryptedChar = encryptedChar ^ keyChar;
        decodedMessage += String.fromCharCode(decryptedChar);
    }
    return _decoder.decode(new Uint8Array(_encoder.encode(decodedMessage)));
}

/**
 * Load and decrypt all keys from gemma_code.jsonl.
 * Each line format: {"key":"<encrypted_string>"}
 *
 * On error, auto-rotate to next key and retry (handled in callGeminiAPI).
 */
async function loadApiKeys() {
    try {
        const res = await fetch("./gemma_code.jsonl");
        if (!res.ok) throw new Error("Failed to load gemma_code.jsonl: " + res.status);
        const text = await res.text();

        apiKeys = text
            .split("\n")
            .map(line => line.trim())
            .filter(line => line.length > 0)
            .map(line => {
                try {
                    const encryptedKey = JSON.parse(line).key;
                    return decryptKey(encryptedKey, XOR_SEED);
                } catch {
                    return null;
                }
            })
            .filter(k => k && k.length > 0);

        if (apiKeys.length === 0) throw new Error("No valid API keys found in gemma_code.jsonl");
        currentKeyIndex = 0;
        console.log(`[KeyRotation] Loaded ${apiKeys.length} API key(s).`);
    } catch (err) {
        console.error("[KeyRotation] " + err.message);
        apiKeys = [];
    }
}

// --- Rate-limit / retry helpers ---

var RATE_LIMIT_MAX_RETRIES = 5;
var RATE_LIMIT_BASE_DELAY = 1000; // 1 second

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Fetch with automatic retry on 429 (rate limit) and 500 (server error).
 * Returns the Response on success or after exhausting retries.
 */
async function fetchWithRetry(url, options) {
    for (let retry = 0; retry <= RATE_LIMIT_MAX_RETRIES; retry++) {
        const response = await fetch(url, options);

        if (response.status === 429 || response.status === 500) {
            if (retry === RATE_LIMIT_MAX_RETRIES) return response;

            // Use Retry-After header if present, otherwise exponential backoff
            const retryAfter = response.headers.get("Retry-After");
            const delay = retryAfter
                ? parseInt(retryAfter) * 1000
                : RATE_LIMIT_BASE_DELAY * Math.pow(2, retry);
            console.warn(`[RateLimit] ${response.status} — retrying in ${delay}ms (attempt ${retry + 1}/${RATE_LIMIT_MAX_RETRIES})`);
            await sleep(delay);
            continue;
        }

        return response;
    }
}

function getCurrentKey() {
    if (apiKeys.length === 0) throw new Error("No API keys available. Check gemma_code.jsonl.");
    // Proactively rotate after every N uses
    if (keyUseCount > 0 && keyUseCount % ROTATE_EVERY_N === 0 && apiKeys.length > 1) {
        console.log(`[KeyRotation] Proactive rotation after ${ROTATE_EVERY_N} uses`);
        rotateKey();
    }
    keyUseCount++;
    return apiKeys[currentKeyIndex];
}

function rotateKey() {
    if (apiKeys.length === 0) return;
    const prev = currentKeyIndex;
    currentKeyIndex = (currentKeyIndex + 1) % apiKeys.length;
    console.warn(`[KeyRotation] Rotated from key #${prev + 1} → key #${currentKeyIndex + 1} of ${apiKeys.length}`);
}

/**
 * Call the Gemini API with key rotation and retry logic.
 * @param {string} model - Model name (e.g. "gemma-3-27b-it")
 * @param {object} userMessage - Message object with role and parts
 * @param {Array} chatHistory - Conversation history array (modified in place)
 * @param {object} generationConfig - Generation config object
 * @returns {Promise<object>} API result
 */
async function callGeminiAPI(model, userMessage, chatHistory, generationConfig) {
    chatHistory.push(userMessage);

    const maxAttempts = apiKeys.length || 1;
    let lastError = null;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const key = getCurrentKey();
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
        try {
            const response = await fetchWithRetry(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ contents: chatHistory, generationConfig })
            });
            if (!response.ok) {
                const errText = await response.text();
                const errMsg = `API error ${response.status} (key #${currentKeyIndex + 1}): ${errText.slice(0, 120)}`;
                console.warn("[KeyRotation] " + errMsg);
                lastError = new Error(errMsg);
                rotateKey();
                continue;
            }
            const result = await response.json();
            if (!result.candidates?.length) throw new Error("No response from API");
            chatHistory.push({ role: "model", parts: result.candidates[0].content.parts });
            return result;
        } catch (err) {
            if (err.message.startsWith("API error")) { lastError = err; continue; }
            throw err;
        }
    }

    // All keys exhausted
    chatHistory.pop();
    throw lastError || new Error("All API keys failed.");
}