// ============================================================
//  chat_memory.js — IndexedDB Memory & Session Persistence
// ============================================================

const MemoryDB = {
    DB_NAME: 'GemmaClientMemory',
    DB_VERSION: 5,
    _db: null,

    async open() {
        if (this._db) return this._db;
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(this.DB_NAME, this.DB_VERSION);
            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains('memories')) {
                    const store = db.createObjectStore('memories', { keyPath: 'key' });
                    store.createIndex('category', 'category', { unique: false });
                    store.createIndex('timestamp', 'timestamp', { unique: false });
                }
                if (!db.objectStoreNames.contains('sessions')) {
                    db.createObjectStore('sessions', { keyPath: 'id' });
                }
                // Topic Workspace — virtual workspace for context tracking
                if (!db.objectStoreNames.contains('workspace')) {
                    const ws = db.createObjectStore('workspace', { keyPath: 'id', autoIncrement: true });
                    ws.createIndex('timestamp', 'timestamp', { unique: false });
                    ws.createIndex('parentId', 'parentId', { unique: false });
                }
                // Goals — multi-step goal persistence
                if (!db.objectStoreNames.contains('goals')) {
                    const gs = db.createObjectStore('goals', { keyPath: 'id' });
                    gs.createIndex('status', 'status', { unique: false });
                    gs.createIndex('updatedAt', 'updatedAt', { unique: false });
                }
                // Triggers — proactive engine trigger persistence
                if (!db.objectStoreNames.contains('triggers')) {
                    const ts = db.createObjectStore('triggers', { keyPath: 'id' });
                    ts.createIndex('type', 'type', { unique: false });
                    ts.createIndex('status', 'status', { unique: false });
                }
                // Learning — outcome history for experience-driven improvement
                if (!db.objectStoreNames.contains('learning')) {
                    const ls = db.createObjectStore('learning', { keyPath: 'id' });
                    ls.createIndex('queryType', 'queryType', { unique: false });
                    ls.createIndex('timestamp', 'timestamp', { unique: false });
                }
            };
            req.onsuccess = (e) => { this._db = e.target.result; resolve(this._db); };
            req.onerror = (e) => reject(e.target.error);
        });
    },

    async saveMemory(key, value, category = 'general') {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('memories', 'readwrite');
            tx.objectStore('memories').put({ key, value, category, timestamp: Date.now() });
            tx.oncomplete = () => resolve();
            tx.onerror = (e) => reject(e.target.error);
        });
    },

    async getMemory(key) {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const req = db.transaction('memories', 'readonly').objectStore('memories').get(key);
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = (e) => reject(e.target.error);
        });
    },

    async searchMemories(query) {
        const all = await this.getAllMemories();
        const q = query.toLowerCase();
        // Primary: exact/substring match on key, value, or category
        let results = all.filter(m => m.key.toLowerCase().includes(q) || String(m.value).toLowerCase().includes(q) || m.category.toLowerCase().includes(q));
        if (results.length > 0) return results;
        // P28 fallback: word-level matching when exact substring fails.
        // Split query into words (underscores, dashes, spaces) and CJK characters.
        // "cat_name" → ["cat","name"]; "猫の名前" → ["猫","名","前"]
        const words = q.replace(/[_\-\s]/g, ' ').split(/\s+/).filter(w => w.length >= 2);
        const cjkChars = (q.match(/[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/g) || []);
        const tokens = [...new Set([...words, ...cjkChars])];
        if (tokens.length > 0) {
            results = all.filter(m => {
                const mk = m.key.toLowerCase();
                const mv = String(m.value).toLowerCase();
                return tokens.some(w => mk.includes(w) || mv.includes(w));
            });
        }
        return results;
    },

    async getAllMemories() {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const req = db.transaction('memories', 'readonly').objectStore('memories').getAll();
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = (e) => reject(e.target.error);
        });
    },

    async deleteMemory(key) {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('memories', 'readwrite');
            tx.objectStore('memories').delete(key);
            tx.oncomplete = () => resolve(true);
            tx.onerror = (e) => reject(e.target.error);
        });
    },

    async clearAllMemories() {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('memories', 'readwrite');
            tx.objectStore('memories').clear();
            tx.oncomplete = () => resolve();
            tx.onerror = (e) => reject(e.target.error);
        });
    },

    // Session persistence
    async saveSession(chatHistory, sessionTokens) {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('sessions', 'readwrite');
            tx.objectStore('sessions').put({ id: 'current', chatHistory, sessionTokens: sessionTokens || 0, timestamp: Date.now() });
            tx.oncomplete = () => resolve();
            tx.onerror = (e) => reject(e.target.error);
        });
    },

    async loadSession() {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const req = db.transaction('sessions', 'readonly').objectStore('sessions').get('current');
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = (e) => reject(e.target.error);
        });
    },

    async clearSession() {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('sessions', 'readwrite');
            tx.objectStore('sessions').delete('current');
            tx.oncomplete = () => resolve();
            tx.onerror = (e) => reject(e.target.error);
        });
    },

    // Key rotation state persistence
    async saveKeyState(index, useCount) {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('sessions', 'readwrite');
            tx.objectStore('sessions').put({ id: 'keyState', index, useCount, timestamp: Date.now() });
            tx.oncomplete = () => resolve();
            tx.onerror = (e) => reject(e.target.error);
        });
    },

    async loadKeyState() {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const req = db.transaction('sessions', 'readonly').objectStore('sessions').get('keyState');
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = (e) => reject(e.target.error);
        });
    },

    // ===== Topic Workspace — virtual workspace for context tracking =====
    // Each topic: { id (auto), topic, entities[], summary, userText, parentId, depth, timestamp }

    async addTopic(entry) {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('workspace', 'readwrite');
            const data = { ...entry, timestamp: Date.now() };
            const req = tx.objectStore('workspace').add(data);
            req.onsuccess = () => resolve(req.result); // returns auto-generated id
            tx.onerror = (e) => reject(e.target.error);
        });
    },

    async getRecentTopics(limit = 10) {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const store = db.transaction('workspace', 'readonly').objectStore('workspace');
            const results = [];
            const req = store.openCursor(null, 'prev'); // newest first
            req.onsuccess = (e) => {
                const cursor = e.target.result;
                if (cursor && results.length < limit) {
                    results.push(cursor.value);
                    cursor.continue();
                } else {
                    resolve(results);
                }
            };
            req.onerror = (e) => reject(e.target.error);
        });
    },

    async getTopicChain(topicId) {
        const db = await this.open();
        const chain = [];
        let currentId = topicId;
        const store = db.transaction('workspace', 'readonly').objectStore('workspace');
        while (currentId != null && chain.length < 10) {
            const topic = await new Promise((resolve, reject) => {
                const req = store.get(currentId);
                req.onsuccess = () => resolve(req.result || null);
                req.onerror = (e) => reject(e.target.error);
            });
            if (!topic) break;
            chain.unshift(topic); // oldest first
            currentId = topic.parentId;
        }
        return chain;
    },

    async clearWorkspace() {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('workspace', 'readwrite');
            tx.objectStore('workspace').clear();
            tx.oncomplete = () => resolve();
            tx.onerror = (e) => reject(e.target.error);
        });
    },

    // ===== Goals — multi-step goal persistence =====

    async saveGoal(goal) {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('goals', 'readwrite');
            tx.objectStore('goals').put({ ...goal, updatedAt: Date.now() });
            tx.oncomplete = () => resolve();
            tx.onerror = (e) => reject(e.target.error);
        });
    },

    async getGoal(id) {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const req = db.transaction('goals', 'readonly').objectStore('goals').get(id);
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = (e) => reject(e.target.error);
        });
    },

    async getGoals(status) {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const store = db.transaction('goals', 'readonly').objectStore('goals');
            if (status) {
                const idx = store.index('status');
                const req = idx.getAll(status);
                req.onsuccess = () => resolve(req.result || []);
                req.onerror = (e) => reject(e.target.error);
            } else {
                const req = store.getAll();
                req.onsuccess = () => resolve(req.result || []);
                req.onerror = (e) => reject(e.target.error);
            }
        });
    },

    async deleteGoal(id) {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('goals', 'readwrite');
            tx.objectStore('goals').delete(id);
            tx.oncomplete = () => resolve(true);
            tx.onerror = (e) => reject(e.target.error);
        });
    },

    // ── Triggers (Proactive Engine) ──

    async saveTriggers(triggers) {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('triggers', 'readwrite');
            const store = tx.objectStore('triggers');
            store.clear();
            for (const t of triggers) {
                store.put(t);
            }
            tx.oncomplete = () => resolve();
            tx.onerror = (e) => reject(e.target.error);
        });
    },

    async getTriggers(status) {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const store = db.transaction('triggers', 'readonly').objectStore('triggers');
            if (status) {
                const idx = store.index('status');
                const req = idx.getAll(status);
                req.onsuccess = () => resolve(req.result || []);
                req.onerror = (e) => reject(e.target.error);
            } else {
                const req = store.getAll();
                req.onsuccess = () => resolve(req.result || []);
                req.onerror = (e) => reject(e.target.error);
            }
        });
    },

    async deleteTrigger(id) {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('triggers', 'readwrite');
            tx.objectStore('triggers').delete(id);
            tx.oncomplete = () => resolve(true);
            tx.onerror = (e) => reject(e.target.error);
        });
    },

    // ── Learning (Experience History) ──

    async appendLearning(record) {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('learning', 'readwrite');
            tx.objectStore('learning').put(record);
            tx.oncomplete = () => resolve();
            tx.onerror = (e) => reject(e.target.error);
        });
    },

    async saveLearning(records) {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('learning', 'readwrite');
            const store = tx.objectStore('learning');
            store.clear();
            for (const r of records) {
                store.put(r);
            }
            tx.oncomplete = () => resolve();
            tx.onerror = (e) => reject(e.target.error);
        });
    },

    async getLearning() {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const req = db.transaction('learning', 'readonly').objectStore('learning').getAll();
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = (e) => reject(e.target.error);
        });
    }
};
