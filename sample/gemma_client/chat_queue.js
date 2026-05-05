// ============================================================
//  chat_queue.js — Message queue + handleSend
//  References $input, $queuePanel (from chat_app.js),
//  S (from chat_app.js), esc, clog (from chat_utils.js),
//  addMessage, showThinking (from chat_message.js),
//  sendSimpleChat, sendToolChat (from chat_send.js)
//  at call time.
// ============================================================

const messageQueue = [];
let processing = false;

function renderQueue() {
    if (!$queuePanel) return;
    if (messageQueue.length === 0) {
        $queuePanel.innerHTML = '';
        return;
    }
    $queuePanel.innerHTML = messageQueue.map((text, i) =>
        `<div class="queue-item" data-idx="${i}"><span class="queue-num">#${i + 1}</span><span class="queue-text">${esc(text)}</span><button class="queue-del" onclick="removeFromQueue(${i})" title="Remove">&times;</button></div>`
    ).join('');
}

function removeFromQueue(index) {
    if (index >= 0 && index < messageQueue.length) {
        const removed = messageQueue.splice(index, 1)[0];
        clog('info', `Removed from queue: "${removed.slice(0, 40)}..."`);
        renderQueue();
    }
}

async function processQueue() {
    if (processing || messageQueue.length === 0) return;
    processing = true;

    while (messageQueue.length > 0) {
        const text = messageQueue.shift();
        renderQueue();
        addMessage('user', esc(text));
        showThinking();
        if (S.toolMode) await sendToolChat(text);
        else await sendSimpleChat(text);
    }

    processing = false;
    renderQueue();
}

async function handleSend() {
    const text = $input.value.trim();
    if (!text) return;
    $input.value = ''; $input.style.height = 'auto';
    messageQueue.push(text);
    renderQueue();
    clog('info', processing ? `Queued: "${text.slice(0, 40)}..." (${messageQueue.length} in queue)` : `Sending: "${text.slice(0, 40)}..."`);
    processQueue();
}
