// // Copyright (c) 2026 IncogAgent Team (Yifan Xu, Jietong Zhou, Yihang Zou, Yuchu Guo)
(() => {
    const statusEl = document.getElementById('status');
    const signInButton = document.getElementById('signin');
    const logoutButton = document.getElementById('logout');
    const settingsButton = document.getElementById('settings');
    const settingsPanel = document.getElementById('settings-panel');
    const endpointInput = document.getElementById('openai-endpoint');
    const modelInput = document.getElementById('openai-model');
    const apiKeyInput = document.getElementById('openai-api-key');
    const saveSettingsButton = document.getElementById('save-settings');
    const clearSettingsButton = document.getElementById('clear-settings');
    const clearMemoryButton = document.getElementById('clear-memory');
    const settingsStatusEl = document.getElementById('settings-status');

    let isAuthenticated = false;
    let openAIConfigured = false;
    let settingsOpen = false;
    const DEFAULT_MODEL = 'gpt-4o-mini';
    const CHAT_COMPLETIONS_SUFFIX = '/chat/completions';

    const ensureChatCompletionsPath = (value = '') => {
        const trimmed = (value || '').trim();
        if (!trimmed) {
            return '';
        }
        if (/\/chat\/completions(?:\/|\?|$)/i.test(trimmed)) {
            return trimmed;
        }
        const [base, query = ''] = trimmed.split('?');
        const normalizedBase = base.replace(/\/+$/, '');
        const suffixed = `${normalizedBase}${CHAT_COMPLETIONS_SUFFIX}`;
        return query ? `${suffixed}?${query}` : suffixed;
    };

    const hideSettingsStatus = () => {
        settingsStatusEl.hidden = true;
        settingsStatusEl.textContent = '';
        settingsStatusEl.classList.remove('error');
    };

    const showSettingsStatus = (message, isError = false) => {
        settingsStatusEl.textContent = message;
        settingsStatusEl.hidden = !message;
        settingsStatusEl.classList.toggle('error', Boolean(isError));
    };

    const applyAuthUI = () => {
        if (isAuthenticated) {
            signInButton.hidden = true;
            signInButton.disabled = false;
            signInButton.textContent = 'Sign in with Google';
            logoutButton.hidden = false;
            logoutButton.disabled = false;
            logoutButton.textContent = 'Sign out';
        } else {
            signInButton.hidden = false;
            signInButton.disabled = false;
            signInButton.textContent = 'Sign in with Google';
            logoutButton.hidden = true;
            logoutButton.disabled = false;
            logoutButton.textContent = 'Sign out';
        }
    };

    const updateStatusMessage = () => {
        if (!isAuthenticated) {
            statusEl.textContent = 'Please sign in to enable AI summaries.';
        } else if (!openAIConfigured) {
            statusEl.textContent = 'Signed in. Add your OpenAI endpoint and API key to enable AI summaries.';
        } else {
            statusEl.textContent = 'Signed in successfully. Hover over a Gmail thread to view its AI summary.';
        }
    };

    const loadSettings = ({ updateInputs = true } = {}) => {
        return new Promise((resolve) => {
            chrome.storage.local.get(['openAIEndpoint', 'openAIApiKey', 'openAIModel'], (items) => {
                if (chrome.runtime.lastError) {
                    openAIConfigured = false;
                    if (updateInputs) {
                        endpointInput.value = '';
                        modelInput.value = DEFAULT_MODEL;
                        apiKeyInput.value = '';
                    }
                    showSettingsStatus(`Unable to load settings: ${chrome.runtime.lastError.message}`, true);
                    resolve({ endpoint: '', model: DEFAULT_MODEL, apiKey: '' });
                    return;
                }

                const rawEndpoint = (items.openAIEndpoint || '').trim();
                const endpoint = ensureChatCompletionsPath(rawEndpoint);
                if (endpoint && endpoint !== rawEndpoint) {
                    chrome.storage.local.set({ openAIEndpoint: endpoint });
                }
                const model = (items.openAIModel || '').trim() || DEFAULT_MODEL;
                const apiKey = (items.openAIApiKey || '').trim();

                if (updateInputs) {
                    endpointInput.value = endpoint;
                    modelInput.value = model;
                    apiKeyInput.value = apiKey;
                }

                openAIConfigured = Boolean(endpoint && apiKey);
                if (!settingsOpen) {
                    hideSettingsStatus();
                }

                resolve({ endpoint, model, apiKey });
            });
        });
    };

    const setSignedInState = () => {
        isAuthenticated = true;
        applyAuthUI();
        loadSettings({ updateInputs: settingsOpen }).finally(() => {
            updateStatusMessage();
        });
    };

    const setSignedOutState = () => {
        isAuthenticated = false;
        applyAuthUI();
        updateStatusMessage();
    };

    const setErrorState = (message) => {
        statusEl.textContent = message || 'Something went wrong. Please try again.';
        isAuthenticated = false;
        applyAuthUI();
    };

    const sendMessage = (payload) => {
        return new Promise((resolve, reject) => {
            chrome.runtime.sendMessage(payload, (response) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }
                resolve(response);
            });
        });
    };

    const refreshStatus = async () => {
        statusEl.textContent = 'Checking sign-in status...';
        signInButton.disabled = true;
        logoutButton.disabled = true;

        try {
            const response = await sendMessage({ type: 'CHECK_AUTH_STATUS' });
            isAuthenticated = Boolean(response?.success && response.authenticated);
        } catch (error) {
            await loadSettings({ updateInputs: true });
            setErrorState('Unable to verify sign-in status. Please try again.');
            return;
        }

        await loadSettings({ updateInputs: true });
        applyAuthUI();
        updateStatusMessage();
    };

    const handleSignIn = () => {
        signInButton.disabled = true;
        statusEl.textContent = 'Opening Google sign-in...';

        chrome.runtime.sendMessage({ type: 'TRIGGER_INTERACTIVE_SIGNIN' }, (response) => {
            if (chrome.runtime.lastError || !response) {
                setErrorState(chrome.runtime.lastError?.message || 'Sign-in failed. Please try again.');
                return;
            }

            if (response.success) {
                setSignedInState();
                return;
            }

            if (response.code === 'USER_DISMISSED') {
                setErrorState('Sign-in was cancelled. Please try again.');
                return;
            }

            setErrorState(response.error);
        });
    };

    const handleSignOut = () => {
        logoutButton.disabled = true;
        logoutButton.textContent = 'Signing out...';
        statusEl.textContent = 'Signing out...';

        chrome.runtime.sendMessage({ type: 'TRIGGER_LOGOUT' }, (response) => {
            logoutButton.textContent = 'Sign out';

            if (chrome.runtime.lastError || !response) {
                statusEl.textContent = chrome.runtime.lastError?.message || 'Failed to sign out. Please try again.';
                logoutButton.disabled = false;
                return;
            }

            if (response.success) {
                setSignedOutState();
                return;
            }

            statusEl.textContent = response.error || 'Failed to sign out. Please try again.';
            logoutButton.disabled = false;
        });
    };

    const toggleSettingsPanel = () => {
        settingsOpen = !settingsOpen;
        settingsPanel.hidden = !settingsOpen;
        settingsButton.setAttribute('aria-expanded', String(settingsOpen));
        settingsButton.textContent = settingsOpen ? 'Close settings' : 'Settings';

        if (settingsOpen) {
            loadSettings({ updateInputs: true });
            hideSettingsStatus();
        }
    };

    const saveSettings = () => {
        const endpoint = ensureChatCompletionsPath(endpointInput.value.trim());
        const model = modelInput.value.trim();
        const apiKey = apiKeyInput.value.trim();

        saveSettingsButton.disabled = true;
        showSettingsStatus('Saving settings...');

        chrome.storage.local.set({
            openAIEndpoint: endpoint,
            openAIApiKey: apiKey,
            openAIModel: model
        }, () => {
            saveSettingsButton.disabled = false;

            if (chrome.runtime.lastError) {
                showSettingsStatus(`Failed to save settings: ${chrome.runtime.lastError.message}`, true);
                return;
            }

            endpointInput.value = endpoint;
            openAIConfigured = Boolean(endpoint && apiKey);
            showSettingsStatus('Settings saved.');
            if (isAuthenticated) {
                updateStatusMessage();
            }
        });
    };

    const clearSettings = () => {
        saveSettingsButton.disabled = true;
        clearSettingsButton.disabled = true;
        showSettingsStatus('Clearing settings...');

        chrome.storage.local.remove(['openAIEndpoint', 'openAIApiKey', 'openAIModel'], () => {
            saveSettingsButton.disabled = false;
            clearSettingsButton.disabled = false;

            if (chrome.runtime.lastError) {
                showSettingsStatus(`Failed to clear settings: ${chrome.runtime.lastError.message}`, true);
                return;
            }

            endpointInput.value = '';
            modelInput.value = DEFAULT_MODEL;
            apiKeyInput.value = '';
            openAIConfigured = false;
            showSettingsStatus('Settings cleared.');
            if (isAuthenticated) {
                updateStatusMessage();
            }
        });
    };

    const clearCache = async () => {
        if (!clearMemoryButton) {
            return;
        }

        clearMemoryButton.disabled = true;
        showSettingsStatus('Clearing cache...');

        try {
            const response = await sendMessage({ type: 'CLEAR_ANONYMIZER_MEMORY' });
            if (response?.success) {
                showSettingsStatus('Cache cleared.');
            } else {
                showSettingsStatus(response?.error || 'Failed to clear cache.', true);
            }
        } catch (error) {
            showSettingsStatus(error.message || 'Failed to clear cache.', true);
        } finally {
            clearMemoryButton.disabled = false;
        }
    };

    signInButton.addEventListener('click', handleSignIn);
    logoutButton.addEventListener('click', handleSignOut);
    settingsButton.addEventListener('click', toggleSettingsPanel);
    saveSettingsButton.addEventListener('click', saveSettings);
    clearSettingsButton.addEventListener('click', clearSettings);
    if (clearMemoryButton) {
        clearMemoryButton.addEventListener('click', clearCache);
    }

    chrome.runtime.onMessage.addListener((message) => {
        if (message?.type === 'AUTH_STATUS_CHANGED') {
            const authenticated = Boolean(message.payload?.authenticated);
            if (authenticated) {
                setSignedInState();
            } else {
                setSignedOutState();
            }
        } else if (message?.type === 'OPENAI_CONFIG_CHANGED') {
            openAIConfigured = Boolean(message.payload?.configured);
            if (settingsOpen) {
                loadSettings({ updateInputs: true });
            }
            if (isAuthenticated) {
                updateStatusMessage();
            }
        }
    });

    refreshStatus();
})();
