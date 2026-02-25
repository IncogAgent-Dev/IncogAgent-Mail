// Copyright (c) 2026 IncogAgent Team (Yifan Xu, Jietong Zhou, Yihang Zou, Yuchu Guo)

/**
 * Third-party library: compromise.js
 * Link: https://github.com/spencermountain/compromise
 * License: MIT License
 * Copyright (c) 2019 Spencer Kelly
 */

(() => {
    const KEEP_MASK_MARKERS_ON_RESTORE = false;
    const MASK_PLACEHOLDER_REGEX = /\{\{[A-Z0-9_|]+\}\}/g;

    const runtimeGlobal = typeof globalThis !== 'undefined'
        ? globalThis
        : (typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : {}));

    let anonymizerReady = false;
    let anonymizerLoadAttempted = false;
    const loadedScriptPaths = new Set();

    const hasMappingEntries = (mapping) => mapping && Object.keys(mapping).length > 0;

    const normalizeBasePath = (value = '') => {
        const trimmed = String(value || '').trim();
        if (!trimmed) {
            return '';
        }
        return trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
    };

    const ensureAnonymizerLoaded = ({ basePath = '', scriptPaths = [] } = {}) => {
        if (anonymizerReady) {
            return true;
        }

        if (!Array.isArray(scriptPaths) || !scriptPaths.length) {
            anonymizerReady = Boolean(runtimeGlobal?.PrivacyAnonymizer?.anonymizeText);
            return anonymizerReady;
        }

        anonymizerLoadAttempted = true;
        const prefix = normalizeBasePath(basePath);
        const resolvedPaths = scriptPaths.map((path) => `${prefix}${path}`);
        resolvedPaths.forEach((path) => {
            if (!path || loadedScriptPaths.has(path)) {
                return;
            }
            try {
                importScripts(path);
                loadedScriptPaths.add(path);
            } catch (error) {
                console.warn(`Privacy anonymizer script failed to load: ${path}`, error);
            }
        });

        anonymizerReady = Boolean(runtimeGlobal?.PrivacyAnonymizer?.anonymizeText);
        if (!anonymizerReady && anonymizerLoadAttempted) {
            console.warn('Privacy anonymizer unavailable after script loading attempts.');
        }
        return anonymizerReady;
    };

    const applyPrivacyMasking = (text) => {
        if (!text || !runtimeGlobal?.PrivacyAnonymizer?.anonymizeText) {
            return { maskedText: text, mapping: {} };
        }
        try {
            return runtimeGlobal.PrivacyAnonymizer.anonymizeText(text);
        } catch (error) {
            console.warn('Failed to anonymize email content:', error);
            return { maskedText: text, mapping: {} };
        }
    };

    const createExpandedPlaceholderLookup = (mapping) => {
        const expanded = new Map();
        Object.entries(mapping).forEach(([placeholder, value]) => {
            if (!placeholder) {
                return;
            }
            expanded.set(placeholder, value);
            const inner = placeholder.slice(2, -2);
            if (!inner.includes('|')) {
                return;
            }
            inner.split('|').forEach((segment) => {
                if (!segment) {
                    return;
                }
                const singlePlaceholder = `{{${segment}}}`;
                if (!expanded.has(singlePlaceholder)) {
                    expanded.set(singlePlaceholder, value);
                }
            });
        });
        return expanded;
    };

    const restoreMaskedText = (text, mapping) => {
        if (!text || !hasMappingEntries(mapping)) {
            return { text, highlights: [] };
        }

        let restored = '';
        let lastIndex = 0;
        const highlights = [];
        const placeholderLookup = createExpandedPlaceholderLookup(mapping);

        text.replace(MASK_PLACEHOLDER_REGEX, (placeholder, offset) => {
            restored += text.slice(lastIndex, offset);
            const original = placeholderLookup.get(placeholder);
            if (original) {
                const originalText = String(original);
                const startIndex = restored.length;
                const displayText = KEEP_MASK_MARKERS_ON_RESTORE
                    ? `${originalText} (${placeholder})`
                    : originalText;
                restored += displayText;
                highlights.push({
                    start: startIndex,
                    end: startIndex + originalText.length,
                    placeholder,
                    original: originalText
                });
            } else {
                restored += placeholder;
            }
            lastIndex = offset + placeholder.length;
        });

        if (lastIndex < text.length) {
            restored += text.slice(lastIndex);
        }

        return { text: restored, highlights };
    };

    const clearAnonymizerMemory = (memoryKey) => {
        if (!runtimeGlobal?.PrivacyAnonymizer?.clearMemory) {
            return false;
        }
        try {
            runtimeGlobal.PrivacyAnonymizer.clearMemory(memoryKey);
            return true;
        } catch (error) {
            console.warn('Failed to clear anonymizer memory:', error);
            return false;
        }
    };

    runtimeGlobal.PrivacyMasking = {
        init: ({ basePath = '', scriptPaths = [] } = {}) => ensureAnonymizerLoaded({ basePath, scriptPaths }),
        isReady: () => Boolean(runtimeGlobal?.PrivacyAnonymizer?.anonymizeText),
        applyPrivacyMasking,
        restoreMaskedText,
        clearAnonymizerMemory
    };
})();
