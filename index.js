/* global jQuery, $, eventSource, event_types, toastr, Generate */

/** @typedef {{ id: string; text: string; file: File | null; status: 'pending' | 'sending' | 'done' | 'error'; error?: string }} QueueItem */

let queue = /** @type {QueueItem[]} */ ([]);
let isRunning = false;
let currentIndex = 0;

// 当前拖拽源的队列项 id
let dragSourceId = null;

const RIGHT_MENU_ID = 'attachment_queue_block';

function updateStatusText() {
    const $status = $('#attachment_queue_status');
    if (!$status.length) return;

    if (queue.length === 0) {
        $status.text('队列为空');
        return;
    }

    if (!isRunning) {
        $status.text(`已添加 ${queue.length} 个文件，队列已暂停`);
        return;
    }

    $status.text(`正在处理第 ${currentIndex + 1} / ${queue.length} 个文件...`);
}

function renderQueueList() {
    const $list = $('#attachment_queue_list');
    if (!$list.length) return;

    $list.empty();

    // 确保页面上存在一个单文件输入用于替换附件（动态创建并绑定一次）
    let $singleFileInput = $('#attachment_queue_single_file_input');
    if (!$singleFileInput.length) {
        $singleFileInput = $('<input type="file" id="attachment_queue_single_file_input" style="display:none" />');
        $('body').append($singleFileInput);
        $singleFileInput.on('change', function (e) {
            const targetId = $(this).attr('data-target-id');
            if (!targetId) { $(this).val(''); return; }
            const files = e.target.files;
            if (files && files.length) {
                const item = queue.find(q => String(q.id) === String(targetId));
                if (item) {
                    item.file = files[0];
                    item.status = 'pending';
                    item.error = '';
                    renderQueueList();
                    updateStatusText();
                }
            }
            $(this).val('');
            $(this).removeAttr('data-target-id');
        });
    }

    for (const item of queue) {
        const $row = $('<div class="attachment-queue-item flex-container flexGap5" />');

        $row.attr('draggable', 'true');
        $row.attr('data-id', item.id);

        // 状态颜色
        let statusColor = '';
        if (item.status === 'done') statusColor = 'color: var(--SmartThemeSuccessColor, #3fb950);';
        if (item.status === 'error') statusColor = 'color: var(--SmartThemeErrorColor, #ff4d4f);';
        if (item.status === 'sending') statusColor = 'color: var(--SmartThemeAccentColor, #f5a623);';

        // 图标：文件/文本
        let iconClass = 'fa-solid fa-message';
        if (item.file) {
            iconClass = item.file.type && item.file.type.startsWith && item.file.type.startsWith('image/')
                ? 'fa-regular fa-image'
                : item.file.type === 'application/pdf'
                    ? 'fa-regular fa-file-pdf'
                    : 'fa-regular fa-file-lines';
        }

        const $dragHandle = $('<i class="fa-solid fa-grip-lines attachment-queue-drag-handle" />');
        const $icon = $('<i />').addClass(iconClass + ' attachment-queue-item-icon');

        let displayName = item.text || '(空文本)';
        if (item.file) displayName = `${displayName} + ${item.file.name}`;
        const $name = $('<span class="attachment-queue-item-name" />').text(displayName).attr('title', displayName);
        const $status = $('<span class="attachment-queue-item-status" style="' + statusColor + '"/>').text(translateStatus(item.status));
        if (item.status === 'error' && item.error) $status.attr('title', item.error);

        // 操作按钮区域：预览 / 编辑 / 附件替换
        const $actions = $('<span class="attachment-queue-item-actions" />');

        const $eye = $('<button type="button" class="attachment-action-eye fa-regular fa-eye" title="预览" />');
        $eye.on('click', (e) => {
            e.stopPropagation();
            if (window.currentPreviewItemId === item.id) {
                window.currentPreviewItemId = null;
                $('#attachment_queue_preview').slideUp();
            } else {
                window.currentPreviewItemId = item.id;
                showPreviewForItem(item);
            }
        });

        const $editBtn = $('<button type="button" class="attachment-action-edit fa-regular fa-pen-to-square" title="编辑文本" />');
        $editBtn.on('click', (e) => {
            e.stopPropagation();
            editTextItem(item.id);
        });

        const $attachBtn = $('<button type="button" class="attachment-action-attach fa-regular fa-paperclip" title="替换附件" />');
        $attachBtn.on('click', (e) => {
            e.stopPropagation();
            $singleFileInput.attr('data-target-id', item.id);
            $singleFileInput.trigger('click');
        });

        $actions.append($eye, $editBtn, $attachBtn);

        const $remove = $('<button type="button" class="attachment-queue-item-remove fa-solid fa-xmark" title="移除" />');
        $remove.on('click', (e) => {
            e.stopPropagation();
            queue = queue.filter(q => q.id !== item.id);
            if (currentIndex >= queue.length) currentIndex = Math.max(0, queue.length - 1);
            renderQueueList();
            updateStatusText();
            updateSmartControlsVisibility();
        });

        bindDragAndDropEvents($row, item.id);

        // 点击整行打开预览（不影响按钮点击）
        $row.on('click', () => {
            if (window.currentPreviewItemId === item.id) {
                window.currentPreviewItemId = null;
                $('#attachment_queue_preview').slideUp();
            } else {
                window.currentPreviewItemId = item.id;
                showPreviewForItem(item);
            }
        });

        $row.append($dragHandle, $icon, $name, $status, $actions, $remove);
        $list.append($row);
    }

    updateStatusText();
}

let currentPreviewUrl = null;

function showPreviewForItem(item) {
    const $preview = $('#attachment_queue_preview');
    if (!$preview.length) return;
    $preview.hide();
    $preview.empty();

    if (item.text) {
        const $textPre = $('<pre class="attachment-queue-preview-text" />').text(item.text);
        $preview.append($textPre);
    }

    if (!item.file) {
        if (!item.text) {
            const $info = $('<div class="attachment-queue-preview-generic" />').text('(空项目)');
            $preview.append($info);
        }
        $preview.slideDown();
        return;
    }

    const file = item.file;

    if (currentPreviewUrl) {
        URL.revokeObjectURL(currentPreviewUrl);
        currentPreviewUrl = null;
    }

    if (file.type.startsWith('image/')) {
        const url = URL.createObjectURL(file);
        currentPreviewUrl = url;
        const $img = $('<img class="attachment-queue-preview-image" />');
        $img.attr('src', url);
        $img.attr('alt', file.name);
        $preview.append($img);
        $preview.slideDown();
    } else if (file.type.startsWith('text/') || file.type === 'application/json') {
        const reader = new FileReader();
        reader.onload = () => {
            const text = String(reader.result || '').slice(0, 4000);
            const $pre = $('<pre class="attachment-queue-preview-text" />').text(text);
            $preview.append($pre);
            $preview.slideDown();
        };
        reader.readAsText(file);
    } else {
        const $info = $('<div class="attachment-queue-preview-generic" />')
            .text(`${file.name} (${Math.round(file.size / 1024)} KB)`);
        $preview.append($info);
        $preview.slideDown();
    }
}

function translateStatus(status) {
    const map = {
        'pending': '等待中',
        'sending': '发送中',
        'done': '完成',
        'error': '失败'
    };
    return map[status] || status;
}

function addFilesToQueue(files) {
    const items = Array.from(files || []);
    if (!items.length) return;
    const now = Date.now();
    for (let i = 0; i < items.length; i++) {
        const file = items[i];
        const id = `${now}-${i}-${file.name}`;
        queue.push({ id, text: '', file, status: 'pending' });
    }
    renderQueueList();
    updateSmartControlsVisibility();
}

function addTextOnlyToQueue(text = '') {
    const now = Date.now();
    const id = `${now}-text`;
    queue.push({ id, text, file: null, status: 'pending' });
    renderQueueList();
    updateSmartControlsVisibility();
    return id;
}

/**
 * 核心发送逻辑：纯 UI 模拟 (Pure UI Simulation)
 * 放弃所有内部 Generate 调用，直接操作 DOM 元素和事件。
 */
async function uploadAndSend(item) {
    console.log('[Chat Queue] UI Sim: Processing item:', item.id);

    // 1. 处理附件（保持原样）
    if (item.file) {
        const fileInput = document.getElementById('file_form_input');
        if (fileInput) {
            const dt = new DataTransfer();
            dt.items.add(item.file);
            fileInput.files = dt.files;
            $('#file_form_input').trigger('change');
            // 等待附件挂载和 UI 更新
            await new Promise(r => setTimeout(r, 500));
            console.log('[Chat Queue] UI Sim: File input updated');
        }
    }

    // 2. 处理文本（优化）
    const $textarea = $('#send_textarea');
    if ($textarea.length) {
        $textarea.val(item.text || '');
        $textarea.trigger('input');
        $textarea.trigger('change');
        // 等待按钮变绿
        await new Promise(r => setTimeout(r, 300));
        console.log('[Chat Queue] UI Sim: Textarea updated');
    }

    // 3. 触发发送（不在此等待 generation_ended）
    const sendBtn = document.getElementById('send_but');
    if (sendBtn) {
        try {
            sendBtn.click();
            console.log('[Chat Queue] UI Sim: sendBtn.click() invoked');
        } catch (e) {
            console.warn('[Chat Queue] sendBtn.click() failed, trying jQuery trigger', e);
            try { $('#send_but').trigger('click'); } catch (ee) { console.error('[Chat Queue] trigger failed', ee); }
        }
        // 函数不负责等待生成完成，返回 true 表示发送动作已触发
        return true;
    }

    // 备选：如果按钮不存在，再尝试调用 Generate（很少发生）
    if (typeof Generate === 'function') {
        try {
            await Generate('normal');
            return true;
        } catch (e) {
            console.error('[Chat Queue] Fallback Generate() failed', e);
            throw e;
        }
    }

    throw new Error('Send button not found and Generate fallback unavailable');
}

/**
 * 循环处理器
 */
async function processNext() {
    if (!isRunning) return;

    // 找到下一个待发送项
    const nextIndex = queue.findIndex(q => q.status === 'pending');

    if (nextIndex === -1) {
        isRunning = false;
        toastr.success('队列全部完成！');
        updateStatusText();
        renderQueueList();
        return;
    }

    currentIndex = nextIndex;
    const item = queue[currentIndex];

    item.status = 'sending';
    renderQueueList();

    try {
        // 1. 执行发送动作 (填空 + 点按钮)
        await uploadAndSend(item);

        // 2. 等待 AI 回复 (监听全局事件)
        // 我们不在这里死等，而是把 "处理下一个" 的任务交给 eventSource 监听器
        // 这样可以避免 processNext 递归调用栈过深，也符合事件驱动模型
        console.log('[Chat Queue] Waiting for generation_ended event...');

    } catch (err) {
        console.error('[Chat Queue] Error:', err);
        item.status = 'error';
        item.error = String(err);
        toastr.error(`项目 ${currentIndex + 1} 发送失败`);

        // 出错后休息一下继续
        setTimeout(() => {
            if (isRunning) void processNext();
        }, 2000);
        renderQueueList();
    }
}

function editTextItem(itemId) {
    const item = queue.find(q => q.id === itemId);
    if (!item) return;

    const $editor = $('#attachment_queue_editor');
    const $list = $('#attachment_queue_list');
    const $preview = $('#attachment_queue_preview');

    if ($editor.length) {
        $list.addClass('displayNone');
        $preview.addClass('displayNone');
        async function processNext() {
            if (!isRunning) return;

            // 找到下一个待发送项
            const nextIndex = queue.findIndex(q => q.status === 'pending');

            if (nextIndex === -1) {
                isRunning = false;
                toastr.success('队列全部完成！');
                updateStatusText();
                renderQueueList();
                return;
            }

            currentIndex = nextIndex;
            const item = queue[currentIndex];
            item.status = 'sending';
            renderQueueList();

            try {
                // 发送前：若按钮当前显示为停止/生成图标，则先等它恢复
                const waitForSendButtonReadyBefore = (timeoutMs = 120000) => {
                    return new Promise((resolve) => {
                        const start = Date.now();
                        const iv = setInterval(() => {
                            const $btn = $('#send_but');
                            if ($btn.length && $btn.is(':visible') && $btn.css('display') !== 'none') {
                                const isGenerating = $btn.find('.fa-stop, .fa-square').length > 0 || $btn.attr('title') === 'Stop generation';
                                const isReady = $btn.find('.fa-paper-plane').length > 0 && !$btn.prop('disabled');
                                if (!isGenerating && isReady) {
                                    clearInterval(iv);
                                    resolve(true);
                                    return;
                                }
                            }
                            if (Date.now() - start > timeoutMs) {
                                clearInterval(iv);
                                console.warn('[Chat Queue] waitForSendButtonReadyBefore timeout');
                                resolve(false);
                            }
                        }, 500);
                    });
                };

                await waitForSendButtonReadyBefore(120000);

                // 1. 执行发送动作
                await uploadAndSend(item);

                // 2. 发送后轮询按钮状态，判断何时生成完成
                const waitForGenerationToComplete = (timeoutMs = 120000) => {
                    return new Promise((resolve) => {
                        const start = Date.now();
                        const iv = setInterval(() => {
                            const $btn = $('#send_but');
                            if ($btn.length && $btn.is(':visible') && $btn.css('display') !== 'none') {
                                const isGenerating = $btn.find('.fa-stop, .fa-square').length > 0 || $btn.attr('title') === 'Stop generation';
                                const isReady = $btn.find('.fa-paper-plane').length > 0 && !$btn.prop('disabled');
                                if (!isGenerating && isReady) {
                                    clearInterval(iv);
                                    resolve(true);
                                    return;
                                }
                            }
                            if (Date.now() - start > timeoutMs) {
                                clearInterval(iv);
                                console.warn('[Chat Queue] generation wait timeout, proceeding');
                                resolve(false);
                            }
                        }, 500);
                    });
                };

                await waitForGenerationToComplete(120000);

                // 标记完成并继续下一个
                if (queue[currentIndex]) queue[currentIndex].status = 'done';
                currentIndex++;
                renderQueueList();

                // 延迟一点再处理下一条
                setTimeout(() => { if (isRunning) void processNext(); }, 500);

            } catch (err) {
                console.error('[Chat Queue] Error:', err);
                item.status = 'error';
                item.error = String(err);
                toastr.error(`项目 ${currentIndex + 1} 发送失败`);
                // 出错后休息一下继续
                setTimeout(() => {
                    if (isRunning) void processNext();
                }, 2000);
                renderQueueList();
            }
        }
                        <div id="attachment_queue_list" class="attachment-queue-list flex1"></div>
                        <div id="attachment_queue_preview" class="attachment-queue-preview flex1"></div>
                    </div>
                    <div id="attachment_queue_editor" class="attachment-queue-editor displayNone">
                        <textarea id="attachment_queue_text_input" class="attachment-queue-text-input" placeholder="输入文本内容..."></textarea>
                        <div class="flex-container flexGap5">
                            <button id="attachment_queue_save_text" type="button" class="menu_button">保存</button>
                            <button id="attachment_queue_cancel_text" type="button" class="menu_button">取消</button>
                        </div>
                    </div>
                </div>
                <div class="right-nav-footer flex-container flexGap5">
                    <button id="attachment_queue_add" type="button" class="menu_button menu_button_icon">
                        <i class="fa-solid fa-plus"></i>
                        <span>添加文件</span>
                    </button>
                    <button id="attachment_queue_add_text" type="button" class="menu_button menu_button_icon">
                        <i class="fa-solid fa-plus"></i>
                        <span>新增楼层</span>
                    </button>
                    <button id="attachment_queue_clear" type="button" class="menu_button menu_button_icon menu_button-danger">
                        <i class="fa-solid fa-trash-can"></i>
                        <span>清空队列</span>
                    </button>
                    <span class="flex1"></span>
                    <span id="attachment_queue_status" class="attachment-queue-status"></span>
                </div>
                <input id="attachment_queue_file_input" type="file" multiple class="displayNone" />
            </div>`;

        $scrollInner.append(blockHtml);

        const $block = $(`#${RIGHT_MENU_ID}`);
        bindDropZoneEvents($block);
        bindControls($block);
        updateStatusText();

        $('#attachment_queue_add').on('click', () => {
            const inputEl = document.getElementById('attachment_queue_file_input');
            if (inputEl) inputEl.click();
        });

        $('#attachment_queue_add_text').on('click', () => {
            const newId = addTextOnlyToQueue('');
            editTextItem(newId);
        });

        $('#attachment_queue_save_text').on('click', () => {
            const $input = $('#attachment_queue_text_input');
            const text = $input.val() || '';
            const currentEditId = $input.attr('data-edit-id');
            if (currentEditId) {
                const item = queue.find(q => q.id === currentEditId);
                if (item) {
                    item.text = text;
                    renderQueueList();
                }
            }
            cancelEditTextItem();
        });

        $('#attachment_queue_cancel_text').on('click', () => {
            cancelEditTextItem();
        });

        // 注册监听器：当 AI 生成完毕后，继续下一条
        const registerGenerationEnded = () => {
            if (typeof eventSource !== 'undefined' && typeof event_types !== 'undefined' && typeof event_types.GENERATION_ENDED !== 'undefined') {
                eventSource.on(event_types.GENERATION_ENDED, () => {
                    if (!isRunning) return;

                    // 标记当前项完成
                    if (queue[currentIndex] && queue[currentIndex].status === 'sending') {
                        queue[currentIndex].status = 'done';
                        currentIndex++;
                        renderQueueList();

                        if (currentIndex >= queue.length) {
                            isRunning = false;
                            updateSmartControlsVisibility();
                            return;
                        }

                        // 延迟 1 秒后处理下一条
                        setTimeout(() => {
                            if (isRunning) void processNext();
                        }, 1000);
                    }
                });
                return true;
            }
            return false;
        };

        if (!registerGenerationEnded()) {
            const waiter = setInterval(() => {
                if (registerGenerationEnded()) clearInterval(waiter);
            }, 500);
        }
    }
}

function initAttachmentQueueSmartControls() {
    const $send = $('#send_but');
    if (!$send.length) return;

    if (!$('#attachment_queue_play').length) {
        const controlsHtml = `
            <div id="attachment_queue_play" class="fa-solid fa-play interactable displayNone" title="开始附件队列"></div>
            <div id="attachment_queue_pause" class="fa-solid fa-pause interactable displayNone" title="暂停附件队列"></div>`;

        $(controlsHtml).insertAfter($send);

        $('#attachment_queue_play').on('click', () => {
            if (!queue.length) {
                toastr.info('队列为空');
                return;
            }
            const nextIndex = queue.findIndex(q => q.status === 'pending');
            if (nextIndex === -1) {
                toastr.info('没有待发送的文件');
                return;
            }
            currentIndex = nextIndex;
            isRunning = true;
            updateStatusText();
            updateSmartControlsVisibility();
            void processNext();
        });

        $('#attachment_queue_pause').on('click', () => {
            isRunning = false;
            updateStatusText();
            updateSmartControlsVisibility();
        });
    }
    updateSmartControlsVisibility();
}

function updateSmartControlsVisibility() {
    const $play = $('#attachment_queue_play');
    const $pause = $('#attachment_queue_pause');
    if (!$play.length || !$pause.length) return;

    if (queue.length === 0) {
        $play.addClass('displayNone');
        $pause.addClass('displayNone');
        return;
    }

    if (isRunning) {
        $play.addClass('displayNone');
        $pause.removeClass('displayNone');
    } else {
        $play.removeClass('displayNone');
        $pause.addClass('displayNone');
    }
}

function initAttachmentQueueWandButton() {
    const $container = $('#attach_file_wand_container');
    if (!$container.length) return;

    if ($('#attachment_queue_wand_button').length) return;

    const html = `
        <div id="attachment_queue_wand_button" class="list-group-item flex-container flexGap5">
            <div class="fa-fw fa-solid fa-layer-group extensionsMenuExtensionButton"></div>
            <span>附加文件队列</span>
        </div>`;

    const $attachButton = $container.find('#attachFile');
    if ($attachButton.length) {
        $attachButton.after(html);
    } else {
        $container.prepend(html);
    }

    $('#attachment_queue_wand_button').on('click', async () => {
        await initAttachmentQueueRightMenu();
        toggleRightDrawer(RIGHT_MENU_ID);
        // 打开选择器
        const inputEl = document.getElementById('attachment_queue_file_input');
        if (inputEl) inputEl.click();
    });
}

// 侧边栏切换 Helper
const toggleRightDrawer = (targetId) => {
    const $drawer = $('#right-nav-panel');
    const $content = $(`#${targetId}`);

    if ($content.is(':visible') && $drawer.hasClass('openDrawer')) {
        $drawer.removeClass('openDrawer').addClass('closedDrawer');
        $drawer.css('transform', '');
        return;
    }

    $('.right_menu').hide();
    $content.show();
    $drawer.removeClass('closedDrawer').addClass('openDrawer');
    $(window).trigger('resize');
};

/**
 * 绑定拖拽排序事件 (补回漏掉的函数)
 */
function bindDragAndDropEvents($row, id) {
    $row.on('dragstart', (e) => {
        dragSourceId = id;
        $row.addClass('attachment-queue-item-dragging');

        const dt = e.originalEvent?.dataTransfer;
        if (dt) {
            dt.effectAllowed = 'move';
            dt.setData('text/plain', id);
        }
    });

    $row.on('dragover', (e) => {
        e.preventDefault();
        const dt = e.originalEvent?.dataTransfer;
        if (dt) {
            dt.dropEffect = 'move';
        }
        $row.addClass('attachment-queue-item-dragover');
    });

    $row.on('dragleave', () => {
        $row.removeClass('attachment-queue-item-dragover');
    });

    $row.on('dragend', () => {
        $row.removeClass('attachment-queue-item-dragging attachment-queue-item-dragover');
        dragSourceId = null;
    });

    $row.on('drop', (e) => {
        e.preventDefault();
        $row.removeClass('attachment-queue-item-dragover');

        const dt = e.originalEvent?.dataTransfer;
        const sourceId = dt?.getData('text/plain') || dragSourceId;
        const targetId = id;

        if (!sourceId || !targetId || sourceId === targetId) {
            return;
        }

        reorderQueueById(sourceId, targetId);
        renderQueueList();
    });
}

/**
 * 根据拖拽结果重新排序队列 (补回漏掉的函数)
 */
function reorderQueueById(sourceId, targetId) {
    const fromIndex = queue.findIndex(q => q.id === sourceId);
    const toIndex = queue.findIndex(q => q.id === targetId);

    if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) {
        return;
    }

    const [moved] = queue.splice(fromIndex, 1);
    queue.splice(toIndex, 0, moved);

    if (currentIndex === fromIndex) {
        currentIndex = toIndex;
    } else if (fromIndex < currentIndex && toIndex >= currentIndex) {
        currentIndex -= 1;
    } else if (fromIndex > currentIndex && toIndex <= currentIndex) {
        currentIndex += 1;
    }
}

jQuery(() => {
    const entryPoint = async () => {
        if (window.st_chat_queue_loaded) return;
        window.st_chat_queue_loaded = true;
        console.log('🔥 Chat Queue: 插件正在启动...');

        try {
            await initAttachmentQueueRightMenu();
        } catch (e) {
            console.warn('[Chat Queue] Init menu failed, retrying later');
        }
        initAttachmentQueueSmartControls();
        initAttachmentQueueWandButton();

        // 绑定图标
        if (!$('#attachment_queue_icon').length) {
            const iconHtml = `
                <div id="attachment_queue_icon" class="drawer">
                    <div class="drawer-toggle">
                        <div class="drawer-icon fa-solid fa-layer-group fa-fw" title="聊天队列"></div>
                    </div>
                </div>`;
            const $bg = $('#backgrounds-button');
            if ($bg.length) $(iconHtml).insertAfter($bg);
            else $('#top-settings-holder').append(iconHtml);

            $('#attachment_queue_icon .drawer-toggle').on('click', () => {
                // 如果未初始化，再次尝试初始化
                if (!$(`#${RIGHT_MENU_ID}`).length) initAttachmentQueueRightMenu();
                toggleRightDrawer(RIGHT_MENU_ID);
            });
        }
    };

    // 三重保险启动
    try {
        if (typeof eventSource !== 'undefined' && typeof event_types !== 'undefined') {
            eventSource.on(event_types.APP_READY, entryPoint);
        }
    } catch(e){}

    const domAvailable = $('#top-settings-holder').length || $('#send_but').length;
    if (domAvailable) void entryPoint();

    const poll = setInterval(() => {
        if ($('#send_but').length) {
            clearInterval(poll);
            void entryPoint();
        }
    }, 1000);
});

// 内联工具函数
const getBase64Async = (file) => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve(reader.result);
        reader.onerror = (error) => reject(error);
    });
};

const getFileExtension = (file) => {
    const name = file.name || '';
    return name.slice((name.lastIndexOf(".") - 1 >>> 0) + 2);
};
