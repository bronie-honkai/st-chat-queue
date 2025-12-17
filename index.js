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
    // 先隐藏区域，清空内容，渲染后 slideDown 显示（默认折叠）
    $preview.hide();
    $preview.empty();

    // 显示文本内容（如果有）
    if (item.text) {
        const $textPre = $('<pre class="attachment-queue-preview-text" />').text(item.text);
        $preview.append($textPre);
    }

    // 显示附件预览（如果有）
    if (!item.file) {
        if (!item.text) {
            const $info = $('<div class="attachment-queue-preview-generic" />').text('(空项目)');
            $preview.append($info);
        }
        $preview.slideDown();
        return;
    }

    const file = item.file;

    // 清理旧的 object URL
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

/**
 * 将文件加入队列
 */
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

/**
 * 向队列添加纯文本项（新增楼层）
 */
function addTextOnlyToQueue(text = '') {
    const now = Date.now();
    const id = `${now}-text`;
    queue.push({ id, text, file: null, status: 'pending' });
    renderQueueList();
    updateSmartControlsVisibility();
    return id;
}

/**
 * 核心：上传并发送单个队列项（支持文本和附件）
 * 新策略：直接调用 Generate() 函数，让 ST 完整处理文件上传和消息发送
 */
async function uploadAndSend(item) {
    console.log('[Chat Queue] Processing item:', item.id, 'text:', item.text.slice(0, 30), 'file:', item.file?.name);

    // 如果有文件，先上传文件
    if (item.file) {
        const fileInput = document.getElementById('file_form_input');
        if (!(fileInput instanceof HTMLInputElement)) {
            throw new Error('file_form_input not found');
        }

        // 用 DataTransfer 模拟用户选择文件
        const dt = new DataTransfer();
        dt.items.add(item.file);
        fileInput.files = dt.files;

        // 触发 change 事件，ST 会显示文件名
        $('#file_form_input').trigger('change');

        // 等待 UI 更新
        await new Promise(r => setTimeout(r, 100));
        console.log('[Chat Queue] File added to input');
    }

    // 如果有文本内容，设置到发送框
    if (item.text) {
        const $textarea = $('#send_textarea');
        if ($textarea.length) {
            $textarea.val(item.text);
            $textarea.trigger('input');
            $textarea.trigger('change');
            await new Promise(r => setTimeout(r, 100));
            console.log('[Chat Queue] Text content set to textarea');
        }
    }

    // 调用 Generate() 函数发送消息
    console.log('[Chat Queue] Calling Generate()...');
    try {
        await Generate('normal', { automatic_trigger: false });
        console.log('[Chat Queue] Generate() completed successfully');
    } catch (error) {
        console.error('[Chat Queue] Generate() failed:', error);
        throw error;
    }
}

/**
 * 循环处理器 - 支持发送文本和附件
 */
async function processNext() {
    // 每次循环前检查是否仍在运行
    if (!isRunning) return;

    // 找到下一个待发送的文件（从第一个 pending 开始）
    const nextIndex = queue.findIndex(q => q.status === 'pending');

    if (nextIndex === -1) {
        // 没有待发送的文件了
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
        // --- 执行发送逻辑 ---
        await uploadAndSend(item);

        // --- 等待 AI 回复完成 ---
        // 我们不在这里死等，而是利用 EventSource 监听
        // 设置一个标志位，等待 generation_ended 事件来触发下一次 processNext
        // 这里只是为了保险，如果 60秒 没反应则超时
        // 真正的递归调用移交给 eventSource 监听器

    } catch (err) {
        console.error('[Chat Queue] Error:', err);
        item.status = 'error';
        item.error = String(err);
        toastr.error(`项目 ${item.id} 发送失败`);

        // 如果出错，休息 1 秒继续下一个
        currentIndex++;
        setTimeout(() => {
            if (isRunning) void processNext();
        }, 1000);
        renderQueueList();
    }
}

/**
 * 进入编辑模式编辑文本项
 */
function editTextItem(itemId) {
    const item = queue.find(q => q.id === itemId);
    if (!item) return;

    const $editor = $('#attachment_queue_editor');
    const $list = $('#attachment_queue_list');
    const $preview = $('#attachment_queue_preview');

    if ($editor.length) {
        $list.addClass('displayNone');
        $preview.addClass('displayNone');
        $editor.removeClass('displayNone');

        const $input = $('#attachment_queue_text_input');
        $input.val(item.text);
        $input.attr('data-edit-id', itemId);
        $input.focus();
    }
}

/**
 * 退出编辑模式
 */
function cancelEditTextItem() {
    const $editor = $('#attachment_queue_editor');
    const $list = $('#attachment_queue_list');
    const $preview = $('#attachment_queue_preview');

    if ($editor.length) {
        $editor.addClass('displayNone');
        $list.removeClass('displayNone');
        $preview.removeClass('displayNone');

        const $input = $('#attachment_queue_text_input');
        $input.val('');
        $input.attr('data-edit-id', '');
    }
}

function bindDropZoneEvents($root) {
    const $dropZone = $root.find('#attachment_queue_dropzone');
    const $fileInput = $root.find('#attachment_queue_file_input');

    // ... 保持原有逻辑 ...
    $dropZone.on('dragenter dragover', (e) => {
        e.preventDefault(); e.stopPropagation();
        $dropZone.addClass('attachment-queue-dropzone-hover');
    });
    $dropZone.on('dragleave dragend drop', (e) => {
        e.preventDefault(); e.stopPropagation();
        $dropZone.removeClass('attachment-queue-dropzone-hover');
    });
    $dropZone.on('drop', (e) => {
        const dt = e.originalEvent.dataTransfer;
        if (dt) addFilesToQueue(dt.files);
    });
    $dropZone.on('click', () => $fileInput.trigger('click'));
    $fileInput.on('change', (e) => {
        if (e.target.files.length) {
            addFilesToQueue(e.target.files);
            $fileInput.val('');
        }
    });
}

function bindControls($root) {
    const $start = $root.find('#attachment_queue_start');
    const $pause = $root.find('#attachment_queue_pause');
    const $clear = $root.find('#attachment_queue_clear');

    $start.on('click', () => {
        if (!queue.length) return toastr.info('队列为空');

        // 从第一个 pending 项重新开始/继续
        const nextIndex = queue.findIndex(q => q.status === 'pending');
        if (nextIndex === -1) {
            toastr.info('没有待发送的文件');
            return;
        }

        currentIndex = nextIndex;
        isRunning = true;
        updateStatusText();
        void processNext(); // 启动或继续
    });

    $pause.on('click', () => {
        isRunning = false;
        updateStatusText();
    });

    $clear.on('click', () => {
        queue = [];
        currentIndex = 0;
        isRunning = false;
        renderQueueList();
    });
}

async function initAttachmentQueueRightMenu() {
    // 创建右侧面板中的队列 Tab 内容
    if (!$(`#${RIGHT_MENU_ID}`).length) {
        const $scrollInner = $('#right-nav-panel .scrollableInner');
        if (!$scrollInner.length) return;

        const blockHtml = `
            <div id="${RIGHT_MENU_ID}" class="right_menu" style="display: none;">
                <div class="right-nav-header flex-container flexGap5">
                    <span class="attachment-queue-panel-title flex1">聊天队列</span>
                </div>
                <div class="right-nav-content">
                    <div id="attachment_queue_dropzone" class="attachment-queue-dropzone">
                        拖拽文件到这里，或点击添加
                    </div>
                    <div class="attachment-queue-main flex-container flexGap8">
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

        // “添加文件”按钮触发文件选择
        $('#attachment_queue_add').on('click', () => {
            const inputEl = /** @type {HTMLInputElement | null} */ (document.getElementById('attachment_queue_file_input'));
            if (!inputEl) return;

            try {
                if (typeof inputEl.showPicker === 'function') {
                    inputEl.showPicker();
                } else {
                    inputEl.click();
                }
            } catch {
                inputEl.click();
            }
        });

        // "新增楼层"按钮：创建新文本项并进入编辑模式
        $('#attachment_queue_add_text').on('click', () => {
            const newId = addTextOnlyToQueue('');
            editTextItem(newId);
        });

        // 保存文本
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

        // 取消编辑
        $('#attachment_queue_cancel_text').on('click', () => {
            cancelEditTextItem();
        });

        // 注册 AI 回复结束事件，驱动队列继续
        eventSource.on(event_types.GENERATION_ENDED, () => {
            if (!isRunning) return;

            if (queue[currentIndex] && queue[currentIndex].status === 'sending') {
                queue[currentIndex].status = 'done';
                currentIndex++;
                renderQueueList();

                // 检查队列是否全部完成
                if (currentIndex >= queue.length) {
                    // 队列全部完成，停止运行并更新按钮状态
                    isRunning = false;
                    updateSmartControlsVisibility();
                    return;
                }

                setTimeout(() => {
                    if (isRunning) void processNext();
                }, 1000);
            }
        });
    }

    // 在角色管理按钮行中增加一个“附件队列”按钮
    if (!$('#attachment_queue_tab_button').length) {
        const $btnContainer = $('#rm_buttons_container');
        if ($btnContainer.length) {
            const btnHtml = `
                <div id="attachment_queue_tab_button" class="menu_button fa-solid fa-layer-group" title="附件队列"></div>`;
            $btnContainer.append(btnHtml);

            $('#attachment_queue_tab_button').on('click', async () => {
                const $drawer = $('#right-nav-panel');
                const isOpen = $drawer.hasClass('openDrawer');

                // 如果抽屉未打开，先打开它
                if (!isOpen) {
                    const rightNavToggle = document.getElementById('unimportantYes');
                    if (rightNavToggle) {
                        await doNavbarIconClick.call(rightNavToggle);
                    }
                }

                await initAttachmentQueueRightMenu();
                selectRightMenuWithAnimation(RIGHT_MENU_ID);
            });
        }
    }

    // 顶部图标：打开右侧面板并切换到队列 Tab
    if (!$('#attachment_queue_icon').length) {
        const iconHtml = `
            <div id="attachment_queue_icon" class="drawer">
                <div class="drawer-toggle">
                    <div class="drawer-icon fa-solid fa-layer-group fa-fw" title="聊天队列" data-i18n="[title]Chat Queue"></div>
                </div>
            </div>`;

        const $backgrounds = $('#backgrounds-button');
        const $extensions = $('#extensions-settings-button');

        if ($backgrounds.length) {
            $(iconHtml).insertAfter($backgrounds);
        } else if ($extensions.length) {
            $(iconHtml).insertBefore($extensions);
        } else {
            $('#top-settings-holder').append(iconHtml);
        }

        $('#attachment_queue_icon .drawer-toggle').on('click', async function () {
            const $drawer = $('#right-nav-panel');
            const isOpen = $drawer.hasClass('openDrawer');
            const isQueueVisible = $(`#${RIGHT_MENU_ID}`).is(':visible');

            // 如果面板已打开且当前显示的是队列，点击关闭面板（toggle行为）
            if (isOpen && isQueueVisible) {
                const rightNavToggle = document.getElementById('unimportantYes');
                if (rightNavToggle) {
                    await doNavbarIconClick.call(rightNavToggle);
                }
                return;
            }

            // 否则：打开面板（如果未打开）并切换到队列tab
            if (!isOpen) {
                const rightNavToggle = document.getElementById('unimportantYes');
                if (rightNavToggle) {
                    await doNavbarIconClick.call(rightNavToggle);
                }
            }

            await initAttachmentQueueRightMenu();
            selectRightMenuWithAnimation(RIGHT_MENU_ID);
        });
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
                updateSmartControlsVisibility();
                return;
            }

            const nextIndex = queue.findIndex(q => q.status === 'pending');
            if (nextIndex === -1) {
                toastr.info('没有待发送的文件');
                updateSmartControlsVisibility();
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

    if ($('#attachment_queue_wand_button').length) {
        return;
    }

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
        await initAttachmentQueueDrawer();

        const inputEl = /** @type {HTMLInputElement | null} */ (document.getElementById('attachment_queue_file_input'));
        if (!inputEl) return;

        try {
            if (typeof inputEl.showPicker === 'function') {
                inputEl.showPicker();
            } else {
                inputEl.click();
            }
        } catch {
            inputEl.click();
        }

        // 选完文件后，addFilesToQueue 会自动展开面板；这里保证至少是显示的
        $('#attachment_queue_panel').show();
    });
}

jQuery(() => {
    /**
     * entryPoint: 核心启动函数，带防重入保护
     */
    const entryPoint = async () => {
        if (window.st_chat_queue_loaded) return;
        window.st_chat_queue_loaded = true;
        console.log('🔥 Chat Queue: 插件正在启动...');

        // 执行初始化
        await initAttachmentQueueRightMenu();
        initAttachmentQueueSmartControls();
        initAttachmentQueueWandButton();

        // 重写角色管理抽屉图标行为（与之前逻辑一致）
        const $rightNavToggle = $('#unimportantYes');
        if ($rightNavToggle.length) {
            $rightNavToggle.off('click.stAttachmentQueue');
            $rightNavToggle.off('click').on('click', async function () {
                const $drawer = $('#right-nav-panel');
                const isOpen = $drawer.hasClass('openDrawer');
                const isQueueVisible = $(`#${RIGHT_MENU_ID}`).is(':visible');

                if (isOpen && isQueueVisible) {
                    selectRightMenuWithAnimation('rm_characters_block');
                    return;
                }

                await doNavbarIconClick.call(this);

                const nowOpen = $drawer.hasClass('openDrawer');
                if (nowOpen) {
                    selectRightMenuWithAnimation('rm_characters_block');
                }
            });
        }
    };

    // ---------- 三重保险启动策略 ----------
    // 保险 1：标准事件（APP_READY）
    try {
        if (typeof eventSource !== 'undefined' && typeof event_types !== 'undefined' && typeof event_types.APP_READY !== 'undefined') {
            eventSource.on(event_types.APP_READY, entryPoint);
        }
    } catch (e) {
        // 忽略注册失败
    }

    // 保险 2：如果 DOM 元素已存在（表示我们来晚了），立即启动
    const domAvailable = $('#top-settings-holder').length || $('#rm_buttons_container').length || $('#attach_file_wand_container').length || $('#send_but').length;
    if (domAvailable) {
        void entryPoint();
        return;
    }

    // 保险 3：轮询，直到发现 Generate 或 eventSource 可用或关键 DOM 出现
    const poll = setInterval(() => {
        const readyAPIs = (typeof Generate !== 'undefined' && typeof eventSource !== 'undefined' && typeof event_types !== 'undefined');
        const domNow = $('#top-settings-holder').length || $('#rm_buttons_container').length || $('#attach_file_wand_container').length || $('#send_but').length;
        if (readyAPIs || domNow) {
            clearInterval(poll);
            void entryPoint();
        }
    }, 1000);
});

/**
 * 绑定拖拽排序事件
 * @param {JQuery} $row
 * @param {string} id
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
 * 根据拖拽结果重新排序队列
 * @param {string} sourceId
 * @param {string} targetId
 */
function reorderQueueById(sourceId, targetId) {
    const fromIndex = queue.findIndex(q => q.id === sourceId);
    const toIndex = queue.findIndex(q => q.id === targetId);

    if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) {
        return;
    }

    const [moved] = queue.splice(fromIndex, 1);
    queue.splice(toIndex, 0, moved);

    // 修正当前索引，避免越界
    if (currentIndex === fromIndex) {
        currentIndex = toIndex;
    } else if (fromIndex < currentIndex && toIndex >= currentIndex) {
        currentIndex -= 1;
    } else if (fromIndex > currentIndex && toIndex <= currentIndex) {
        currentIndex += 1;
    }
}

// 内联工具函数：替代原先对 utils.js 的依赖
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
