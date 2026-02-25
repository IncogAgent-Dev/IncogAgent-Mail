// Copyright (c) 2026 IncogAgent Team (Yifan Xu, Jietong Zhou, Yihang Zou, Yuchu Guo)
(() => {
    const tooltip = document.createElement('div');
    tooltip.id = 'gmail-hover-preview-tooltip';
    document.body.appendChild(tooltip);

    let currentHoverRow = null;
    let tooltipPositionSet = false;
    let isMouseOnTooltip = false;
    let lastMouseX = 0;
    let lastMouseY = 0;
    let hideTooltipTimer = null; // 延时关闭定时器
    const HIDE_DELAY = 200; // 延时关闭时间（毫秒）
    const summaryCache = new Map();
    const authState = {
        checked: false,
        authenticated: false,
        promise: null
    };

    const LABEL_BUTTON_PREFIX = 'Add label: ';
    const LABEL_ADDING_TEXT = 'Adding label...';
    const LABEL_ADDED_PREFIX = 'Label added: ';
    const LABEL_APPLY_SUCCESS = 'Label added to this thread.';
    const LABEL_APPLY_ERROR_FALLBACK = 'Unable to add label.';
    let labelButtonHandlerAttached = false;

    const SIGN_IN_PROMPT = 'Please sign in using the extension popup to view AI summaries.';
    const AUTH_CHECK_TEXT = 'Checking sign-in status...';
    const SUMMARY_LOADING_TEXT = 'Generating AI summary...';
    const OPENAI_CONFIG_PROMPT = 'Add your OpenAI endpoint and API key in the extension popup to enable summaries.';
    const EMPTY_EMAIL_TEXT = 'No readable content found for this email.';
    const GENERIC_ERROR_TEXT = 'Failed to generate summary.';
    const ACTION_CONFIDENCE_THRESHOLD = 0.6;
    const ACTION_FLAG_TEXT = 'ACTION NEEDED';
    const PRIVACY_PROTECTED_TEXT = 'Your Privacy has been Protected!';
    const PRIVACY_MESSAGE_CLASS = 'ghp-privacy-toast';
    const PRIVACY_MESSAGE_DURATION_MS = 2400;
    const PRIVACY_BG_FADE_DURATION_MS = 600;
    const MASK_CLEAR_CLASS = 'ghp-mask-highlight-cleared';
    const TOAST_EDGE_PADDING = 12;
    const REPLY_ASSIST_SIGN_IN_PROMPT = 'Please sign in using the extension popup to use Reply Assistant.';
    const REPLY_ASSIST_OPENAI_PROMPT = 'Add your OpenAI endpoint and API key in the extension popup to enable Reply Assistant.';
    const REPLY_ASSIST_CONTEXT_ERROR = 'Unable to locate the current email context for this reply box.';
    const REPLY_ASSIST_EMPTY_RESPONSE = 'The assistant returned an empty response.';

    const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

    const positionPrivacyToast = (toast, container, anchor) => {
        if (!toast || !container) {
            return;
        }

        requestAnimationFrame(() => {
            const containerRect = container.getBoundingClientRect();
            const toastRect = toast.getBoundingClientRect();
            if (!containerRect || !containerRect.width || !toastRect) {
                return;
            }

            const toastHalfWidth = toastRect.width / 2;
            let anchorCenter = containerRect.left + (containerRect.width / 2);
            if (anchor && typeof anchor.getBoundingClientRect === 'function') {
                const anchorRect = anchor.getBoundingClientRect();
                if (anchorRect && anchorRect.width) {
                    anchorCenter = anchorRect.left + (anchorRect.width / 2);
                }
            }

            let left = anchorCenter - containerRect.left;
            const minLeft = TOAST_EDGE_PADDING + toastHalfWidth;
            const maxLeft = Math.max(minLeft, containerRect.width - TOAST_EDGE_PADDING - toastHalfWidth);
            left = clamp(left, minLeft, maxLeft);

            toast.style.setProperty('--ghp-toast-left', `${left}px`);
        });
    };

    chrome.runtime.sendMessage(
        {
            type: 'REFRESH_USER_LABELS',
            payload: { interactive: false }
        },
        () => {
            // Ignore errors when refresh is triggered before authentication.
            if (chrome.runtime.lastError) {
                return;
            }
        }
    );

    const updateTooltipPosition = (e) => {
        // 只在首次显示时设置位置，之后保持固定位置
        if (tooltipPositionSet) {
            return;
        }

        const offsetX = 15;
        const offsetY = -8; // 向上移动30px（从15改为-15）
        let left = e.clientX + offsetX;
        let top = e.clientY + offsetY;

        if (left + tooltip.offsetWidth > window.innerWidth) {
            left = e.clientX - tooltip.offsetWidth - offsetX;
        }
        // 如果超出窗口顶部，显示在鼠标下方
        if (top < 0) {
            top = e.clientY - offsetY; // 显示在鼠标下方
        }
        // 如果超出窗口底部，显示在鼠标上方（但保持向上偏移）
        if (top + tooltip.offsetHeight > window.innerHeight) {
            top = e.clientY - tooltip.offsetHeight - offsetY;
        }

        tooltip.style.left = `${left}px`;
        tooltip.style.top = `${top}px`;
        tooltipPositionSet = true;
    };

    const hideTooltip = () => {
        // 清除延时关闭定时器
        if (hideTooltipTimer) {
            clearTimeout(hideTooltipTimer);
            hideTooltipTimer = null;
        }
        currentHoverRow = null;
        tooltipPositionSet = false;
        isMouseOnTooltip = false;
        tooltip.classList.remove('visible');
        delete tooltip.dataset.messageId;
    };

    // 取消延时关闭
    const cancelHideTooltip = () => {
        if (hideTooltipTimer) {
            clearTimeout(hideTooltipTimer);
            hideTooltipTimer = null;
        }
    };

    // 启动延时关闭
    const scheduleHideTooltip = () => {
        // 先清除之前的定时器
        cancelHideTooltip();
        // 设置新的延时关闭定时器
        hideTooltipTimer = setTimeout(() => {
            hideTooltip();
        }, HIDE_DELAY);
    };

    // 检查鼠标是否在悬浮窗或其扩展区域内
    const isMouseInTooltipArea = (target) => {
        if (!target) return false;
        // 检查是否在悬浮窗内
        if (target === tooltip || tooltip.contains(target)) {
            return true;
        }
        return false;
    };

    // 检查鼠标坐标是否在悬浮窗扩展区域内
    const isMouseInExtendedArea = (x, y) => {
        if (!tooltip.classList.contains('visible')) {
            return false;
        }
        const rect = tooltip.getBoundingClientRect();
        const extendedLeft = rect.left - 30; // 左边扩展30px
        const extendedRight = rect.right + 10; // 右边扩展10px
        const extendedTop = rect.top - 10; // 上边扩展10px
        const extendedBottom = rect.bottom + 10; // 下边扩展10px
        
        return x >= extendedLeft && x <= extendedRight && 
               y >= extendedTop && y <= extendedBottom;
    };

    // 检查鼠标是否在邮件行上
    const isMouseOnEmailRow = (target) => {
        if (!target) return false;
        const row = target.closest('tr.zA');
        return row !== null && row === currentHoverRow;
    };

    // 检查鼠标是否应该保持弹窗显示（在邮件行或悬浮窗上）
    const shouldKeepTooltipVisible = (target, x, y) => {
        // 检查是否在悬浮窗上
        if (isMouseInTooltipArea(target)) {
            return true;
        }
        // 检查是否在悬浮窗扩展区域内
        if (isMouseInExtendedArea(x, y)) {
            return true;
        }
        // 检查是否在当前邮件行上
        if (isMouseOnEmailRow(target)) {
            return true;
        }
        return false;
    };

    const ensureLayout = () => {
        if (!tooltip.querySelector('.ghp-meta')) {
            tooltip.innerHTML = `
                <div class="ghp-action-flag" hidden>${ACTION_FLAG_TEXT}</div>
                <div class="ghp-sender"></div>
                <div class="ghp-subject"></div>
                <div class="ghp-meta">
                    <div class="ghp-meta-left">
                        <div class="ghp-type"></div>
                    </div>
                    <button class="ghp-label-button" type="button" hidden></button>
                </div>
                <div class="ghp-label-feedback" hidden></div>
                <hr class="ghp-divider">
                <div class="ghp-snippet"></div>
            `;
        }

        const elements = {
            sender: tooltip.querySelector('.ghp-sender'),
            subject: tooltip.querySelector('.ghp-subject'),
            type: tooltip.querySelector('.ghp-type'),
            actionFlag: tooltip.querySelector('.ghp-action-flag'),
            snippet: tooltip.querySelector('.ghp-snippet'),
            labelButton: tooltip.querySelector('.ghp-label-button'),
            labelFeedback: tooltip.querySelector('.ghp-label-feedback')
        };

        if (elements.labelButton && !labelButtonHandlerAttached) {
            elements.labelButton.addEventListener('click', handleLabelButtonClick);
            labelButtonHandlerAttached = true;
        }

        return elements;
    };

    const showLabelFeedback = (elements, message, isError = false) => {
        if (!elements.labelFeedback) {
            return;
        }
        if (!message) {
            elements.labelFeedback.hidden = true;
            elements.labelFeedback.textContent = '';
            elements.labelFeedback.classList.remove('error');
            return;
        }
        elements.labelFeedback.hidden = false;
        elements.labelFeedback.textContent = message;
        elements.labelFeedback.classList.toggle('error', Boolean(isError));
    };

    const resetLabelButton = (elements) => {
        if (!elements.labelButton) {
            return;
        }
        elements.labelButton.hidden = true;
        elements.labelButton.disabled = false;
        elements.labelButton.dataset.label = '';
        elements.labelButton.dataset.messageId = '';
        elements.labelButton.dataset.state = 'idle';
        elements.labelButton.textContent = '';
        elements.labelButton.classList.remove('applied');
    };

    const updateLabelButton = (elements, label, applied = false) => {
        if (!elements.labelButton) {
            return;
        }

        if (!label || !tooltip.dataset.messageId) {
            resetLabelButton(elements);
            showLabelFeedback(elements, '');
            return;
        }

        elements.labelButton.hidden = false;
        elements.labelButton.dataset.label = label;
        elements.labelButton.dataset.messageId = tooltip.dataset.messageId;

        if (applied) {
            elements.labelButton.disabled = true;
            elements.labelButton.dataset.state = 'applied';
            elements.labelButton.classList.add('applied');
            elements.labelButton.textContent = `${LABEL_ADDED_PREFIX}${label}`;
            showLabelFeedback(elements, LABEL_APPLY_SUCCESS);
        } else {
            elements.labelButton.disabled = false;
            elements.labelButton.dataset.state = 'idle';
            elements.labelButton.classList.remove('applied');
            elements.labelButton.textContent = `${LABEL_BUTTON_PREFIX}${label}`;
            showLabelFeedback(elements, '');
        }
    };

    const updateActionFlag = (elements, replyDecision) => {
        if (!elements.actionFlag) {
            return;
        }

        const hasConfidence = typeof replyDecision?.confidence === 'number';
        const meetsCriteria = Boolean(
            replyDecision?.actionNeeded
            && hasConfidence
            && replyDecision.confidence >= ACTION_CONFIDENCE_THRESHOLD
            && !replyDecision.requiresHumanReview
        );

        if (meetsCriteria) {
            elements.actionFlag.hidden = false;
            elements.actionFlag.textContent = ACTION_FLAG_TEXT;
        } else {
            elements.actionFlag.hidden = true;
            elements.actionFlag.textContent = '';
        }
    };

    const logActionDecision = (messageId, replyDecision) => {
        if (!replyDecision || !replyDecision.reason) {
            return;
        }

        const parts = [
            `[IncogAgent] Action decision for message ${messageId}`,
            `actionNeeded=${replyDecision.actionNeeded ? 'true' : 'false'}`
        ];

        if (typeof replyDecision.confidence === 'number') {
            parts.push(`confidence=${replyDecision.confidence.toFixed(2)}`);
        }

        if (replyDecision.requiresHumanReview) {
            parts.push('requiresHumanReview=true');
        }

        parts.push(`reason=${replyDecision.reason}`);

        if (replyDecision.suggestedAction) {
            parts.push(`suggestedAction=${replyDecision.suggestedAction}`);
        }

        console.info(parts.join(' | '));
    };

    function handleLabelButtonClick(event) {
        event.preventDefault();
        const elements = ensureLayout();
        if (!elements.labelButton) {
            return;
        }

        const button = elements.labelButton;
        const cachedMessageId = button.dataset.messageId || tooltip.dataset.messageId || '';
        const label = button.dataset.label || '';

        if (!label || !cachedMessageId || button.disabled) {
            return;
        }

        button.disabled = true;
        button.dataset.state = 'pending';
        button.classList.remove('applied');
        button.textContent = LABEL_ADDING_TEXT;
        showLabelFeedback(elements, '');

        chrome.runtime.sendMessage(
            {
                type: 'APPLY_LABEL_TO_MESSAGE',
                payload: { messageId: cachedMessageId, label, interactive: true }
            },
            (response) => {
                if (tooltip.dataset.messageId !== cachedMessageId) {
                    return;
                }

                if (chrome.runtime.lastError || !response) {
                    const errorMessage = chrome.runtime.lastError?.message || LABEL_APPLY_ERROR_FALLBACK;
                    button.disabled = false;
                    button.dataset.state = 'idle';
                    button.textContent = `${LABEL_BUTTON_PREFIX}${label}`;
                    showLabelFeedback(elements, errorMessage, true);
                    return;
                }

                if (response.success) {
                    button.disabled = true;
                    button.dataset.state = 'applied';
                    button.classList.add('applied');
                    button.textContent = `${LABEL_ADDED_PREFIX}${label}`;
                    showLabelFeedback(elements, LABEL_APPLY_SUCCESS);
                    const cached = summaryCache.get(cachedMessageId);
                    if (cached) {
                        summaryCache.set(cachedMessageId, { ...cached, labelApplied: true });
                    }
                } else {
                    button.disabled = false;
                    button.dataset.state = 'idle';
                    button.textContent = `${LABEL_BUTTON_PREFIX}${label}`;
                    showLabelFeedback(elements, response.error || LABEL_APPLY_ERROR_FALLBACK, true);
                }
            }
        );
    }

    const extractEmailData = (row) => {
        const senderEl = row.querySelector('.yX .yW span') || row.querySelector('.zF') || row.querySelector('.yP');
        const subjectEl = row.querySelector('.bog');
        const snippetEl = row.querySelector('.y2');
        let messageId = row.getAttribute('data-legacy-last-message-id')
            || row.getAttribute('data-legacy-message-id')
            || row.getAttribute('data-message-id');

        if (!messageId) {
            const container = row.querySelector('[data-legacy-last-message-id]')
                || row.querySelector('[data-legacy-message-id]');
            if (container) {
                messageId = container.getAttribute('data-legacy-last-message-id')
                    || container.getAttribute('data-legacy-message-id');
            }
        }

        return {
            sender: senderEl ? senderEl.textContent.trim() : 'Unknown sender',
            subject: subjectEl ? subjectEl.textContent.trim() : '(No subject)',
            snippet: snippetEl ? snippetEl.textContent.replace(/^-\s*/, '').trim() : 'No preview available...',
            messageId
        };
    };

    const fetchEmailSummary = (messageId, interactive = false) => {
        if (summaryCache.has(messageId)) {
            const cached = summaryCache.get(messageId);
            logActionDecision(messageId, cached?.replyDecision || null);
            return Promise.resolve(cached);
        }

        return new Promise((resolve, reject) => {
            chrome.runtime.sendMessage(
                {
                    type: 'FETCH_GMAIL_SUMMARY',
                    payload: { messageId, interactive }
                },
                (response) => {
                    if (chrome.runtime.lastError) {
                        reject(new Error(chrome.runtime.lastError.message));
                        return;
                    }
                    if (!response) {
                        reject(new Error('No response from extension.'));
                        return;
                    }
                    if (!response.success) {
                        const error = new Error(response.error || GENERIC_ERROR_TEXT);
                        if (response.code) {
                            error.code = response.code;
                        }
                        reject(error);
                        return;
                    }

                    const summary = response.data && typeof response.data.summary === 'string'
                        ? response.data.summary.trim()
                        : '';
                    const type = response.data && typeof response.data.type === 'string'
                        ? response.data.type.trim()
                        : '';
                    const label = response.data && typeof response.data.label === 'string'
                        ? response.data.label.trim()
                        : '';

                    if (!summary) {
                        const error = new Error(GENERIC_ERROR_TEXT);
                        error.code = 'SUMMARY_EMPTY';
                        reject(error);
                        return;
                    }

                    const replyDecisionSource = response.data && typeof response.data.replyDecision === 'object'
                        ? response.data.replyDecision
                        : null;
                    let replyDecision = null;
                    if (replyDecisionSource) {
                        const confidenceValue = typeof replyDecisionSource.confidence === 'number'
                            && Number.isFinite(replyDecisionSource.confidence)
                            ? replyDecisionSource.confidence
                            : null;
                        const rawActionNeeded = replyDecisionSource.actionNeeded;
                        const legacyNeedsReply = replyDecisionSource.needsReply;
                        const actionNeeded = typeof rawActionNeeded === 'boolean'
                            ? rawActionNeeded
                            : typeof legacyNeedsReply === 'boolean'
                                ? legacyNeedsReply
                                : Boolean(rawActionNeeded ?? legacyNeedsReply);
                        replyDecision = {
                            actionNeeded,
                            confidence: confidenceValue,
                            reason: typeof replyDecisionSource.reason === 'string'
                                ? replyDecisionSource.reason.trim()
                                : '',
                            requiresHumanReview: Boolean(replyDecisionSource.requiresHumanReview),
                            suggestedAction: typeof replyDecisionSource.suggestedAction === 'string'
                                ? replyDecisionSource.suggestedAction.trim()
                                : ''
                        };

                        if (!replyDecision.reason) {
                            replyDecision = null;
                        }
                    }

                    const previous = summaryCache.get(messageId);
                    const labelApplied = Boolean(previous?.labelApplied && previous?.label === label && label);
                    const payload = {
                        summary,
                        type,
                        label,
                        labelApplied,
                        replyDecision,
                        maskHighlights: Array.isArray(response.data?.maskHighlights)
                            ? response.data.maskHighlights
                            : []
                    };
                    summaryCache.set(messageId, payload);
                    logActionDecision(messageId, replyDecision);
                    resolve(payload);
                }
            );
        });
    };

    const renderSnippetContent = (element, text, highlightRanges = []) => {
        if (!element) {
            return;
        }

        element.textContent = '';

        if (!text) {
            return;
        }

        if (!Array.isArray(highlightRanges) || !highlightRanges.length) {
            element.textContent = text;
            return;
        }

        const fragment = document.createDocumentFragment();
        let cursor = 0;
        let hasHighlights = false;
        let firstHighlightSpan = null;

        highlightRanges
            .filter((range) => Number.isFinite(range?.start) && Number.isFinite(range?.end))
            .sort((a, b) => a.start - b.start)
            .forEach((range) => {
                const start = Math.max(0, Math.min(range.start, text.length));
                const end = Math.max(start, Math.min(range.end, text.length));
                if (start > cursor) {
                    fragment.appendChild(document.createTextNode(text.slice(cursor, start)));
                }
                if (end > start) {
                    const span = document.createElement('span');
                    span.className = 'ghp-mask-highlight';
                    span.textContent = text.slice(start, end);
                    span.title = 'Protected by IncogAgent — this text stayed private before calling the AI.';
                    fragment.appendChild(span);
                    if (!firstHighlightSpan) {
                        firstHighlightSpan = span;
                    }
                    window.setTimeout(() => {
                        span.classList.add(MASK_CLEAR_CLASS);
                    }, Math.max(0, PRIVACY_MESSAGE_DURATION_MS - PRIVACY_BG_FADE_DURATION_MS));
                    hasHighlights = true;
                }
                cursor = Math.max(cursor, end);
            });

        if (cursor < text.length) {
            fragment.appendChild(document.createTextNode(text.slice(cursor)));
        }

        element.appendChild(fragment);

        if (hasHighlights) {
            const toast = document.createElement('span');
            toast.className = PRIVACY_MESSAGE_CLASS;
            toast.textContent = PRIVACY_PROTECTED_TEXT;
            element.appendChild(toast);
            positionPrivacyToast(toast, element, firstHighlightSpan);
        }
    };

    const showMessage = (elements, data) => {
        elements.sender.textContent = data.sender;
        elements.subject.textContent = data.subject;
        elements.type.textContent = data.type ? `Type: ${data.type}` : '';
        renderSnippetContent(elements.snippet, data.message, data.maskHighlights);
        updateLabelButton(elements, data.label, Boolean(data.labelApplied));
        updateActionFlag(elements, data.replyDecision || null);
    };

    const showStatusMessage = (elements, message) => {
        elements.type.textContent = '';
        renderSnippetContent(elements.snippet, message, []);
        updateLabelButton(elements, '', false);
        updateActionFlag(elements, null);
    };

    const ensureAuthStatus = () => {
        if (authState.checked) {
            return Promise.resolve(authState.authenticated);
        }

        if (authState.promise) {
            return authState.promise;
        }

        authState.promise = new Promise((resolve) => {
            chrome.runtime.sendMessage({ type: 'CHECK_AUTH_STATUS' }, (response) => {
                authState.promise = null;

                if (chrome.runtime.lastError || !response) {
                    authState.checked = false;
                    authState.authenticated = false;
                    resolve(false);
                    return;
                }

                if (!response.success) {
                    authState.checked = false;
                    authState.authenticated = false;
                    resolve(false);
                    return;
                }

                authState.checked = true;
                authState.authenticated = Boolean(response.authenticated);
                resolve(authState.authenticated);
            });
        });

        return authState.promise;
    };

    chrome.runtime.onMessage.addListener((message) => {
        if (message?.type === 'AUTH_STATUS_CHANGED') {
            const authenticated = Boolean(message.payload?.authenticated);
            authState.checked = true;
            authState.authenticated = authenticated;
            authState.promise = null;
            if (!authenticated) {
                summaryCache.clear();
            }
        } else if (message?.type === 'OPENAI_CONFIG_CHANGED') {
            summaryCache.clear();
            if (!message.payload?.configured && tooltip.classList.contains('visible')) {
                const elements = ensureLayout();
                showStatusMessage(elements, OPENAI_CONFIG_PROMPT);
            }
        }
    });

    // 监听悬浮窗的鼠标事件
    tooltip.addEventListener('mouseenter', () => {
        isMouseOnTooltip = true;
        cancelHideTooltip(); // 取消延时关闭
    });

    tooltip.addEventListener('mouseleave', () => {
        isMouseOnTooltip = false;
        // 启动延时关闭，但会在mousemove中检查是否应该取消
        scheduleHideTooltip();
    });

    // 监听鼠标移动，更新鼠标坐标并检查是否应该保持弹窗显示
    document.addEventListener('mousemove', (e) => {
        lastMouseX = e.clientX;
        lastMouseY = e.clientY;
        
        // 如果弹窗可见，检查鼠标是否在应该保持显示的区域
        if (tooltip.classList.contains('visible')) {
            if (shouldKeepTooltipVisible(e.target, e.clientX, e.clientY)) {
                // 鼠标在邮件行或悬浮窗上，取消延时关闭
                cancelHideTooltip();
                isMouseOnTooltip = true;
            } else if (currentHoverRow) {
                // 鼠标不在相关区域，且当前有邮件行，启动延时关闭
                // 但只在还没有定时器时才启动，避免频繁创建
                if (!hideTooltipTimer) {
                    scheduleHideTooltip();
                }
            }
        }
    });

    document.addEventListener('mouseover', (e) => {
        // 检查鼠标是否在应该保持显示的区域（悬浮窗或扩展区域）
        if (shouldKeepTooltipVisible(e.target, lastMouseX, lastMouseY)) {
            // 如果鼠标在悬浮窗上，取消延时关闭
            cancelHideTooltip();
            isMouseOnTooltip = true;
        }

        const row = e.target.closest('tr.zA');

        if (!row) {
            // 如果鼠标不在邮件行上，且不在悬浮窗上，启动延时关闭
            if (currentHoverRow && !shouldKeepTooltipVisible(e.target, lastMouseX, lastMouseY)) {
                scheduleHideTooltip();
            }
            return;
        }

        // 如果鼠标在同一邮件行上，保持弹窗显示（位置已固定）
        if (currentHoverRow === row) {
            cancelHideTooltip(); // 取消延时关闭
            return;
        }

        // 新的邮件行，显示弹窗
        cancelHideTooltip(); // 取消任何待执行的关闭操作
        currentHoverRow = row;
        tooltipPositionSet = false; // 重置位置标志，允许设置新位置
        const data = extractEmailData(row);
        const elements = ensureLayout();

        tooltip.dataset.messageId = data.messageId || '';

        showMessage(elements, {
            sender: data.sender,
            subject: data.subject,
            type: '',
            label: '',
            labelApplied: false,
            message: AUTH_CHECK_TEXT
        });
        tooltip.classList.add('visible');
        updateTooltipPosition(e);

        if (!data.messageId) {
            showStatusMessage(elements, 'Unable to identify the message ID.');
            return;
        }

        ensureAuthStatus()
            .then((authenticated) => {
                if (!tooltip.classList.contains('visible') || tooltip.dataset.messageId !== data.messageId) {
                    return;
                }

                if (!authenticated) {
                    showStatusMessage(elements, SIGN_IN_PROMPT);
                    return;
                }

                showStatusMessage(elements, SUMMARY_LOADING_TEXT);

                fetchEmailSummary(data.messageId, false)
                    .then((summaryText) => {
                        if (!tooltip.classList.contains('visible') || tooltip.dataset.messageId !== data.messageId) {
                            return;
                        }

                        showMessage(elements, {
                            sender: data.sender,
                            subject: data.subject,
                            type: summaryText.type,
                            label: summaryText.label,
                            labelApplied: summaryText.labelApplied,
                            message: summaryText.summary,
                            maskHighlights: Array.isArray(summaryText.maskHighlights)
                                ? summaryText.maskHighlights
                                : [],
                            replyDecision: summaryText.replyDecision
                        });
                    })
                    .catch((err) => {
                        if (!tooltip.classList.contains('visible') || tooltip.dataset.messageId !== data.messageId) {
                            return;
                        }

                        if (err.code === 'AUTH_REQUIRED') {
                            authState.checked = true;
                            authState.authenticated = false;
                            showStatusMessage(elements, SIGN_IN_PROMPT);
                            return;
                        }

                        if (err.code === 'MISSING_OPENAI_CONFIG') {
                            showStatusMessage(elements, OPENAI_CONFIG_PROMPT);
                            return;
                        }

                        if (err.code === 'EMPTY_EMAIL') {
                            showStatusMessage(elements, EMPTY_EMAIL_TEXT);
                            return;
                        }

                        showStatusMessage(elements, err.message || GENERIC_ERROR_TEXT);
                    });
            })
            .catch(() => {
                if (!tooltip.classList.contains('visible') || tooltip.dataset.messageId !== data.messageId) {
                    return;
                }
                authState.checked = false;
                authState.authenticated = false;
                showStatusMessage(elements, SIGN_IN_PROMPT);
            });
    });

    const replyAssistStateByEditor = new WeakMap();
    const replyAssistEditors = new Set();
    let replyAssistScanScheduled = false;
    let replyAssistPositionScheduled = false;

    const sendRuntimeMessage = (payload) => {
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

    const makeComposeSessionId = () => {
        if (typeof crypto?.randomUUID === 'function') {
            return crypto.randomUUID();
        }
        return `reply-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    };

    const isVisibleElement = (element) => {
        if (!element || !(element instanceof HTMLElement)) {
            return false;
        }
        if (element.offsetParent === null) {
            return false;
        }
        const rect = element.getBoundingClientRect();
        return rect.width > 40 && rect.height > 18;
    };

    const clampToViewport = (value, min, max) => Math.min(Math.max(value, min), max);

    const isReplyEditor = (editor) => {
        if (!(editor instanceof HTMLElement)) {
            return false;
        }
        if (editor.id === 'gmail-hover-preview-tooltip') {
            return false;
        }
        if (editor.getAttribute('contenteditable') !== 'true') {
            return false;
        }
        if (editor.getAttribute('role') !== 'textbox') {
            return false;
        }
        if (!isVisibleElement(editor)) {
            return false;
        }
        if (editor.closest('[role="dialog"]')) {
            return false;
        }
        if (!editor.closest('[role="main"]')) {
            return false;
        }
        return true;
    };

    const getContextMessageIdForEditor = (editor) => {
        const root = editor.closest('[role="main"]') || document;
        const editorRect = editor.getBoundingClientRect();
        const candidates = Array.from(root.querySelectorAll('[data-legacy-last-message-id], [data-legacy-message-id], [data-message-id]'));
        let closestId = '';
        let closestDistance = Number.POSITIVE_INFINITY;

        let ancestor = editor;
        while (ancestor && ancestor !== document.body) {
            if (ancestor instanceof HTMLElement) {
                const ancestorId = ancestor.getAttribute('data-legacy-last-message-id')
                    || ancestor.getAttribute('data-legacy-message-id')
                    || ancestor.getAttribute('data-message-id');
                if (ancestorId) {
                    return ancestorId;
                }
            }
            ancestor = ancestor.parentElement;
        }

        candidates.forEach((node) => {
            if (!(node instanceof HTMLElement)) {
                return;
            }
            const messageId = node.getAttribute('data-legacy-last-message-id')
                || node.getAttribute('data-legacy-message-id')
                || node.getAttribute('data-message-id');
            if (!messageId) {
                return;
            }
            const relation = node.compareDocumentPosition(editor);
            if (!(relation & Node.DOCUMENT_POSITION_FOLLOWING) && !(relation & Node.DOCUMENT_POSITION_CONTAINED_BY)) {
                return;
            }
            const rect = node.getBoundingClientRect();
            if (rect.top > editorRect.top + 20) {
                return;
            }
            const distance = Math.abs(editorRect.top - rect.top);
            if (distance < closestDistance) {
                closestDistance = distance;
                closestId = messageId;
            }
        });

        if (closestId) {
            return closestId;
        }

        for (let i = candidates.length - 1; i >= 0; i -= 1) {
            const node = candidates[i];
            if (!(node instanceof HTMLElement)) {
                continue;
            }
            const fallbackId = node.getAttribute('data-legacy-last-message-id')
                || node.getAttribute('data-legacy-message-id')
                || node.getAttribute('data-message-id');
            if (fallbackId) {
                return fallbackId;
            }
        }

        return '';
    };

    const positionReplyAssistUI = (editor, state) => {
        if (!state?.button || !state?.panel) {
            return;
        }

        if (!editor.isConnected || !isVisibleElement(editor)) {
            state.button.style.display = 'none';
            state.panel.style.display = state.panel.classList.contains('visible') ? 'flex' : 'none';
            return;
        }

        const rect = editor.getBoundingClientRect();
        const buttonWidth = 28;
        const buttonHeight = 28;
        const edgePadding = 8;

        const buttonLeft = clampToViewport(
            rect.right - buttonWidth - edgePadding,
            edgePadding,
            Math.max(edgePadding, window.innerWidth - buttonWidth - edgePadding)
        );
        const buttonTop = clampToViewport(
            rect.bottom - buttonHeight - edgePadding,
            edgePadding,
            Math.max(edgePadding, window.innerHeight - buttonHeight - edgePadding)
        );

        state.button.style.display = 'inline-flex';
        state.button.style.left = `${buttonLeft}px`;
        state.button.style.top = `${buttonTop}px`;

        if (!state.panel.classList.contains('visible')) {
            return;
        }

        state.panel.style.display = 'flex';
        const panelWidth = 400;
        const panelHeight = Math.max(200, Math.min(560, state.panel.offsetHeight || 320));
        const panelLeft = clampToViewport(
            buttonLeft + buttonWidth - panelWidth,
            edgePadding,
            Math.max(edgePadding, window.innerWidth - panelWidth - edgePadding)
        );
        let panelTop = buttonTop - panelHeight - 10;
        if (panelTop < edgePadding) {
            panelTop = buttonTop + buttonHeight + 8;
        }
        panelTop = clampToViewport(
            panelTop,
            edgePadding,
            Math.max(edgePadding, window.innerHeight - panelHeight - edgePadding)
        );

        state.panel.style.left = `${panelLeft}px`;
        state.panel.style.top = `${panelTop}px`;
    };

    const refreshReplyAssistPositions = () => {
        replyAssistEditors.forEach((editor) => {
            const state = replyAssistStateByEditor.get(editor);
            if (!editor.isConnected || !state) {
                state?.button?.remove();
                state?.panel?.remove();
                replyAssistStateByEditor.delete(editor);
                replyAssistEditors.delete(editor);
                return;
            }
            positionReplyAssistUI(editor, state);
        });
    };

    const scheduleReplyAssistPositionRefresh = () => {
        if (replyAssistPositionScheduled) {
            return;
        }
        replyAssistPositionScheduled = true;
        window.requestAnimationFrame(() => {
            replyAssistPositionScheduled = false;
            refreshReplyAssistPositions();
        });
    };

    const dispatchEditorInputEvents = (editor) => {
        try {
            editor.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText' }));
        } catch (error) {
            editor.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
        }
        editor.dispatchEvent(new Event('change', { bubbles: true }));
        editor.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: ' ' }));
    };

    const placeCaretAtEnd = (editor) => {
        const selection = window.getSelection();
        if (!selection) {
            return;
        }
        const range = document.createRange();
        range.selectNodeContents(editor);
        range.collapse(false);
        selection.removeAllRanges();
        selection.addRange(range);
    };

    const insertTextToEditor = (editor, text) => {
        if (!editor || !text) {
            return false;
        }
        editor.focus();
        let success = false;
        try {
            success = document.execCommand('insertText', false, text);
        } catch (error) {
            success = false;
        }

        if (!success) {
            const selection = window.getSelection();
            if (selection && selection.rangeCount) {
                const range = selection.getRangeAt(0);
                range.deleteContents();
                const textNode = document.createTextNode(text);
                range.insertNode(textNode);
                range.setStartAfter(textNode);
                range.collapse(true);
                selection.removeAllRanges();
                selection.addRange(range);
                success = true;
            } else {
                editor.appendChild(document.createTextNode(text));
                placeCaretAtEnd(editor);
                success = true;
            }
        }

        dispatchEditorInputEvents(editor);
        return success;
    };

    const replaceEditorText = (editor, text) => {
        if (!editor) {
            return false;
        }
        editor.focus();
        let success = false;
        try {
            const selection = window.getSelection();
            const range = document.createRange();
            range.selectNodeContents(editor);
            if (selection) {
                selection.removeAllRanges();
                selection.addRange(range);
            }
            success = document.execCommand('insertText', false, text);
        } catch (error) {
            success = false;
        }

        if (!success) {
            editor.textContent = text;
            placeCaretAtEnd(editor);
            success = true;
        }

        dispatchEditorInputEvents(editor);
        return success;
    };

    const setReplyAssistStatus = (state, message, isError = false) => {
        if (!state?.status) {
            return;
        }
        state.status.textContent = message || '';
        state.status.classList.toggle('error', Boolean(isError));
    };

    const appendReplyHistory = (state, role, text) => {
        if (!state?.history || !text) {
            return;
        }
        const row = document.createElement('div');
        row.className = `privagent-chat-item ${role === 'user' ? 'user' : 'assistant'}`;
        row.textContent = text;
        state.history.appendChild(row);
        state.history.scrollTop = state.history.scrollHeight;
    };

    const toggleReplyPanel = (state, isOpen) => {
        if (!state?.panel) {
            return;
        }
        state.panel.classList.toggle('visible', Boolean(isOpen));
        state.panel.style.display = isOpen ? 'flex' : 'none';
        state.button?.setAttribute('aria-expanded', String(Boolean(isOpen)));
        if (isOpen) {
            state.input?.focus();
        }
        if (state.editor) {
            positionReplyAssistUI(state.editor, state);
        }
    };

    const setReplyBusy = (state, busy) => {
        state.busy = Boolean(busy);
        if (state.askButton) {
            state.askButton.disabled = state.busy;
            state.askButton.innerHTML = state.busy 
                ? '<svg viewBox="0 0 24 24" fill="none" class="spinner" width="16" height="16" stroke="currentColor" stroke-width="2"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>'
                : '<svg viewBox="0 0 24 24" fill="none" width="16" height="16" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>';
        }
    };

    const clearReplySession = (state) => {
        if (!state?.contextMessageId || !state?.composeSessionId) {
            return;
        }
        chrome.runtime.sendMessage({
            type: 'REPLY_ASSIST_CLEAR_SESSION',
            payload: {
                contextMessageId: state.contextMessageId,
                composeSessionId: state.composeSessionId
            }
        }, () => {
            if (chrome.runtime.lastError) {
                return;
            }
        });
    };

    const handleReplyAsk = async (editor) => {
        const state = replyAssistStateByEditor.get(editor);
        if (!state || state.busy) {
            return;
        }

        const askText = state.input?.value?.trim() || '';
        if (!askText) {
            setReplyAssistStatus(state, 'Please enter your request first.', true);
            return;
        }

        const contextMessageId = getContextMessageIdForEditor(editor);
        if (!contextMessageId) {
            setReplyAssistStatus(state, REPLY_ASSIST_CONTEXT_ERROR, true);
            return;
        }
        state.contextMessageId = contextMessageId;

        const authenticated = await ensureAuthStatus();
        if (!authenticated) {
            setReplyAssistStatus(state, REPLY_ASSIST_SIGN_IN_PROMPT, true);
            return;
        }

        setReplyBusy(state, true);
        setReplyAssistStatus(state, 'Generating reply...');
        appendReplyHistory(state, 'user', askText);

        try {
            const response = await sendRuntimeMessage({
                type: 'REPLY_ASSIST_ASK',
                payload: {
                    composeSessionId: state.composeSessionId,
                    contextMessageId,
                    draftText: editor.innerText?.trim() || '',
                    askText
                }
            });

            if (!response?.success) {
                const err = new Error(response?.error || 'Reply assistant request failed.');
                err.code = response?.code;
                throw err;
            }

            const assistantText = response?.data?.assistantText?.trim() || '';
            if (!assistantText) {
                setReplyAssistStatus(state, REPLY_ASSIST_EMPTY_RESPONSE, true);
                return;
            }

            state.lastAssistantText = assistantText;
            appendReplyHistory(state, 'assistant', assistantText);
            state.input.value = '';
            state.input.style.height = 'auto'; 
            setReplyAssistStatus(state, '');
        } catch (error) {
            if (error?.code === 'AUTH_REQUIRED') {
                setReplyAssistStatus(state, REPLY_ASSIST_SIGN_IN_PROMPT, true);
            } else if (error?.code === 'MISSING_OPENAI_CONFIG') {
                setReplyAssistStatus(state, REPLY_ASSIST_OPENAI_PROMPT, true);
            } else if (error?.code === 'EMPTY_EMAIL') {
                setReplyAssistStatus(state, 'Current email has no readable content.', true);
            } else {
                setReplyAssistStatus(state, error?.message || 'Failed to generate reply.', true);
            }
        } finally {
            setReplyBusy(state, false);
            if (state.askButton) {
                state.askButton.disabled = !state.input.value.trim();
            }
        }
    };

    const handleReplyInsert = (editor) => {
        const state = replyAssistStateByEditor.get(editor);
        const text = state?.lastAssistantText || '';
        if (!text) {
            setReplyAssistStatus(state, 'No assistant output yet. Ask first.', true);
            return;
        }
        insertTextToEditor(editor, text);
        setReplyAssistStatus(state, 'Inserted into reply box.');
    };

    const handleReplyReplace = (editor) => {
        const state = replyAssistStateByEditor.get(editor);
        const text = state?.lastAssistantText || '';
        if (!text) {
            setReplyAssistStatus(state, 'No assistant output yet. Ask first.', true);
            return;
        }
        replaceEditorText(editor, text);
        setReplyAssistStatus(state, 'Reply box replaced.');
    };

    const bindReplyPanelEvents = (editor, state) => {
        const updateAskButtonState = () => {
            if (state.askButton && !state.busy) {
                state.askButton.disabled = !state.input.value.trim();
            }
        };

        // Initialize
        updateAskButtonState();

        state.button.addEventListener('click', () => {
            const shouldOpen = !state.panel.classList.contains('visible');
            toggleReplyPanel(state, shouldOpen);
            if (shouldOpen) {
                updateAskButtonState();
            }
        });

        state.askButton.addEventListener('click', () => {
            handleReplyAsk(editor);
        });

        state.input.addEventListener('input', () => {
            state.input.style.height = 'auto';
            state.input.style.height = Math.min(state.input.scrollHeight, 120) + 'px';
            updateAskButtonState();
        });

        state.input.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                handleReplyAsk(editor);
            }
        });

        state.insertButton.addEventListener('click', () => handleReplyInsert(editor));
        state.replaceButton.addEventListener('click', () => handleReplyReplace(editor));
        state.closeButton.addEventListener('click', () => {
            toggleReplyPanel(state, false);
            clearReplySession(state);
        });
    };

    const createReplyAssistUIForEditor = (editor) => {
        if (replyAssistStateByEditor.has(editor) || !isReplyEditor(editor)) {
            return;
        }
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'privagent-entry';
        button.textContent = '✨';
        button.title = 'IncogAgent™ Reply Assistant';
        button.setAttribute('aria-expanded', 'false');

        const panel = document.createElement('div');
        panel.className = 'privagent-panel';
        panel.innerHTML = `
            <div class="privagent-header">
                <span class="privagent-title">✨ IncogAgent™ Reply</span>
                <button type="button" class="privagent-icon-btn" data-action="close" title="Close">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                </button>
            </div>
            <div class="privagent-body">
                <div class="privagent-chat-history"></div>
                <div class="privagent-input-area">
                    <textarea class="privagent-input" placeholder="Ask AI to draft a reply (e.g. 'Polite refusal')..." rows="1"></textarea>
                    <button type="button" class="privagent-send-btn" data-action="ask" title="Send">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="22" y1="2" x2="11" y2="13"></line>
                            <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                        </svg>
                    </button>
                </div>
                <div class="privagent-tools">
                    <button type="button" class="privagent-tool-btn" data-action="insert">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:4px;">
                            <path d="M12 5v14M5 12h14"/>
                        </svg>
                        Insert
                    </button>
                    <button type="button" class="privagent-tool-btn" data-action="replace">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:4px;">
                            <path d="M4 22h14a2 2 0 0 0 2-2V7.5L14.5 2H6a2 2 0 0 0-2 2v4"/>
                            <polyline points="14 2 14 8 20 8"/>
                            <path d="M2 15h10"/>
                            <path d="M9 18l3-3-3-3"/>
                        </svg>
                        Replace
                    </button>
                </div>
                <div class="privagent-status"></div>
            </div>
        `;

        document.body.appendChild(button);
        document.body.appendChild(panel);

        const state = {
            editor,
            composeSessionId: makeComposeSessionId(),
            contextMessageId: '',
            button,
            panel,
            history: panel.querySelector('.privagent-chat-history'),
            input: panel.querySelector('.privagent-input'),
            askButton: panel.querySelector('button[data-action="ask"]'),
            insertButton: panel.querySelector('button[data-action="insert"]'),
            replaceButton: panel.querySelector('button[data-action="replace"]'),
            closeButton: panel.querySelector('button[data-action="close"]'),
            status: panel.querySelector('.privagent-status'),
            lastAssistantText: '',
            busy: false
        };

        replyAssistStateByEditor.set(editor, state);
        replyAssistEditors.add(editor);
        bindReplyPanelEvents(editor, state);
        positionReplyAssistUI(editor, state);
    };

    const scanReplyEditors = () => {
        const editors = document.querySelectorAll('div[contenteditable="true"][role="textbox"]');
        editors.forEach((editor) => {
            createReplyAssistUIForEditor(editor);
        });
        scheduleReplyAssistPositionRefresh();
    };

    const scheduleReplyEditorScan = () => {
        if (replyAssistScanScheduled) {
            return;
        }
        replyAssistScanScheduled = true;
        window.requestAnimationFrame(() => {
            replyAssistScanScheduled = false;
            scanReplyEditors();
        });
    };

    const observeReplyEditors = () => {
        const observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                if (mutation.type !== 'childList' || !mutation.addedNodes.length) {
                    continue;
                }
                scheduleReplyEditorScan();
                break;
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
        scheduleReplyEditorScan();
    };

    observeReplyEditors();
    window.addEventListener('scroll', scheduleReplyAssistPositionRefresh, true);
    window.addEventListener('resize', scheduleReplyAssistPositionRefresh);

    console.log('IncogAgent Mail Smart Summary loaded with AI summary mode');
})();
