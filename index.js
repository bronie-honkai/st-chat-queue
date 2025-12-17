/* global jQuery, $, eventSource, event_types, toastr, Generate */

/** @typedef {{ id: string; text: string; file: File | null; status: 'pending' | 'sending' | 'done' | 'error'; error?: string }} QueueItem */

let queue = /** @type {QueueItem[]} */ ([]);
let isRunning = false;
let currentIndex = 0;
let dragSourceId = null;

const RIGHT_MENU_ID = 'attachment_queue_block';

// ==========================================
// 核心逻辑区：发送与等待 (Core Logic)
// ==========================================

/**
 * 辅助函数：等待 AI 回复完成
 * 逻辑：轮询检查发送按钮的状态，直到它变回“纸飞机”且可用
 */
function waitForAiToFinish() {
    return new Promise((resolve) => {
        console.log('[Chat Queue] 开始监听 AI 回复状态...');

        // 初始等待：给酒馆一点时间把按钮变成“停止”状态，避免脚本跑太快误判
        let safetyWait = setTimeout(() => {

            const checkInterval = setInterval(() => {
                // 如果用户手动点了停止队列，强行终止监听
                if (!isRunning) {
                    clearInterval(checkInterval);
                    resolve('stopped_by_user');
                    return;
                }

                const $btn = $('#send_but');

                // 1. 检查按钮是否存在
                if ($btn.length === 0) return;

                // 2. 检查关键标识
                // 正在生成通常会有 fa-stop 或 fa-square 图标
                const isStopping = $btn.find('.fa-stop, .fa-square').length > 0;
                // 空闲状态通常会有 fa-paper-plane 图标
                const hasPlane = $btn.find('.fa-paper-plane').length > 0;
                // 检查是否禁用
                const isDisabled = $btn.prop('disabled') || $btn.hasClass('disabled');

                // 3. 判断逻辑：有飞机 + 没停止图标 + 没禁用 = 完成
                if (hasPlane && !isStopping && !isDisabled) {
                    console.log('[Chat Queue] 检测到纸飞机图标回归，AI 回复完成。');
                    clearInterval(checkInterval);
                    resolve('done');
                }
            }, 500); // 每 0.5 秒看一眼

        }, 2000); // 先等 2 秒，让子弹飞一会儿
    });
}

/**
 * 上传并触发发送动作 (只负责点火，不负责灭火)
 */
async function uploadAndSend(item) {
    console.log('[Chat Queue] 处理楼层:', item.id);

    // 1. 挂载附件 (如果有)
    if (item.file) {
        const fileInput = document.getElementById('file_form_input');
        if (fileInput) {
            const dt = new DataTransfer();
            dt.items.add(item.file);
            fileInput.files = dt.files;
            $('#file_form_input').trigger('change');
            // 等待附件缩略图渲染
            await new Promise(r => setTimeout(r, 800));
        }
    }

    // 2. 填入文本
    const $textarea = $('#send_textarea');
    if ($textarea.length) {
        $textarea.val('').trigger('input'); // 清空
        $textarea.val(item.text || '');
        $textarea.trigger('input');
        $textarea.trigger('change');
        // 等待按钮亮起
        await new Promise(r => setTimeout(r, 300));
    }

    // 3. 点击发送 (物理点击)
    const sendBtn = document.getElementById('send_but');
    if (sendBtn) {
        // 尝试移除可能存在的 disabled (防止UI卡顿导致的误判)
        $(sendBtn).removeClass('disabled').prop('disabled', false);
        sendBtn.click();
        console.log('[Chat Queue] 这里的代码已经点击了发送按钮');
    } else {
        throw new Error('找不到发送按钮 (#send_but)');
    }
}

/**
 * 队列主循环
 */
async function processNext() {
    if (!isRunning) return;

    const nextIndex = queue.findIndex(q => q.status === 'pending');

    if (nextIndex === -1) {
        isRunning = false;
        toastr.success('队列全部完成！');
        updateStatusText();
        renderQueueList();
        updateSmartControlsVisibility();
        return;
    }

    currentIndex = nextIndex;
    const item = queue[currentIndex];

    item.status = 'sending';
    renderQueueList();

    try {
        // 1. 发送 (填内容 -> 点按钮)
        await uploadAndSend(item);

        // 2. 等待 (死盯着按钮看，直到纸飞机回来)
        await waitForAiToFinish();

        // 3. 标记完成，继续下一个
        if (isRunning) { // 再次检查是否被暂停
            item.status = 'done';
            renderQueueList();

            // 休息 1 秒再发下一条，太快容易报错
            setTimeout(() => {
                void processNext();
            }, 1000);
        }

    } catch (err) {
        console.error('[Chat Queue] Error:', err);
        item.status = 'error';
        item.error = String(err);
        toastr.error(`楼层发送失败: ${err.message}`);

        // 出错后暂停，不继续
        isRunning = false;
        renderQueueList();
        updateStatusText();
        updateSmartControlsVisibility();
    }
}

// ==========================================
// UI 渲染与交互区 (UI Rendering)
// ==========================================

function updateStatusText() {
    const $status = $('#attachment_queue_status');
    if (!$status.length) return;
    if (queue.length === 0) {
        $status.text('队列为空');
        return;
    }
    if (!isRunning) {
        $status.text(`已添加 ${queue.length} 个楼层，队列暂停中`);
        return;
    }
    $status.text(`正在处理...`);
}

function renderQueueList() {
    const $list = $('#attachment_queue_list');
    if (!$list.length) return;
    $list.empty();

    // 确保单文件替换输入框存在
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
                    renderQueueList();
                }
            }
            $(this).val('');
        });
    }

    for (const item of queue) {
        const $row = $('<div class="attachment-queue-item flex-container flexGap5" />');
        $row.attr('draggable', 'true');
        $row.attr('data-id', item.id);

        let statusColor = '';
        if (item.status === 'done') statusColor = 'color: var(--SmartThemeSuccessColor, #3fb950);';
        if (item.status === 'error') statusColor = 'color: var(--SmartThemeErrorColor, #ff4d4f);';
        if (item.status === 'sending') statusColor = 'color: var(--SmartThemeAccentColor, #f5a623);';

        let iconClass = 'fa-solid fa-message';
        if (item.file) {
            iconClass = item.file.type?.startsWith('image/') ? 'fa-regular fa-image' : 'fa-regular fa-file-lines';
        }

        const $dragHandle = $('<i class="fa-solid fa-grip-lines attachment-queue-drag-handle" />');
        const $icon = $('<i />').addClass(iconClass + ' attachment-queue-item-icon');

        let displayName = item.text || '(空文本)';
        if (item.file) displayName = `${displayName} + ${item.file.name}`;

        const $name = $('<span class="attachment-queue-item-name" />').text(displayName);
        const $status = $('<span class="attachment-queue-item-status" style="' + statusColor + '"/>').text(translateStatus(item.status));

        // 操作按钮
        const $actions = $('<span class="attachment-queue-item-actions" />');

        const $eye = $('<button type="button" class="fa-regular fa-eye" title="预览" />').on('click', (e) => {
            e.stopPropagation();
            togglePreview(item);
        });

        const $editBtn = $('<button type="button" class="fa-regular fa-pen-to-square" title="编辑" />').on('click', (e) => {
            e.stopPropagation();
            editTextItem(item.id);
        });

        const $attachBtn = $('<button type="button" class="fa-regular fa-paperclip" title="附件" />').on('click', (e) => {
            e.stopPropagation();
            $singleFileInput.attr('data-target-id', item.id);
            $singleFileInput.trigger('click');
        });

        $actions.append($eye, $editBtn, $attachBtn);

        const $remove = $('<button type="button" class="attachment-queue-item-remove fa-solid fa-xmark" title="删除" />').on('click', (e) => {
            e.stopPropagation();
            queue = queue.filter(q => q.id !== item.id);
            renderQueueList();
            updateStatusText();
            updateSmartControlsVisibility();
        });

        bindDragAndDropEvents($row, item.id);
        $row.on('click', () => togglePreview(item));

        $row.append($dragHandle, $icon, $name, $status, $actions, $remove);
        $list.append($row);
    }
    updateStatusText();
}

function togglePreview(item) {
    const $preview = $('#attachment_queue_preview');
    if (window.currentPreviewItemId === item.id) {
        window.currentPreviewItemId = null;
        $preview.slideUp();
    } else {
        window.currentPreviewItemId = item.id;
        $preview.hide().empty();

        if (item.text) $preview.append($('<pre class="attachment-queue-preview-text"/>').text(item.text));

        if (item.file) {
            if (item.file.type.startsWith('image/')) {
                const url = URL.createObjectURL(item.file);
                $preview.append($('<img class="attachment-queue-preview-image"/>').attr('src', url));
            } else {
                $preview.append($('<div class="attachment-queue-preview-generic"/>').text(item.file.name));
            }
        }
        $preview.slideDown();
    }
}

function translateStatus(status) {
    const map = { 'pending': '等待中', 'sending': '发送中', 'done': '完成', 'error': '失败' };
    return map[status] || status;
}

function addFilesToQueue(files) {
    const items = Array.from(files || []);
    if (!items.length) return;
    const now = Date.now();
    for (let i = 0; i < items.length; i++) {
        queue.push({ id: `${now}-${i}`, text: '', file: items[i], status: 'pending' });
    }
    renderQueueList();
    updateSmartControlsVisibility();
}

function addTextOnlyToQueue(text = '') {
    const id = `${Date.now()}-text`;
    queue.push({ id, text, file: null, status: 'pending' });
    renderQueueList();
    updateSmartControlsVisibility();
    return id;
}

function editTextItem(itemId) {
    const item = queue.find(q => q.id === itemId);
    if (!item) return;
    $('#attachment_queue_list, #attachment_queue_preview').addClass('displayNone');
    $('#attachment_queue_editor').removeClass('displayNone');
    $('#attachment_queue_text_input').val(item.text).attr('data-edit-id', itemId).focus();
}

function cancelEditTextItem() {
    $('#attachment_queue_editor').addClass('displayNone');
    $('#attachment_queue_list, #attachment_queue_preview').removeClass('displayNone');
    $('#attachment_queue_text_input').val('');
}

function bindDragAndDropEvents($row, id) {
    $row.on('dragstart', (e) => {
        dragSourceId = id;
        $row.addClass('attachment-queue-item-dragging');
        if (e.originalEvent.dataTransfer) e.originalEvent.dataTransfer.effectAllowed = 'move';
    });
    $row.on('dragover', (e) => { e.preventDefault(); $row.addClass('attachment-queue-item-dragover'); });
    $row.on('dragleave', () => { $row.removeClass('attachment-queue-item-dragover'); });
    $row.on('dragend', () => { $row.removeClass('attachment-queue-item-dragging attachment-queue-item-dragover'); });
    $row.on('drop', (e) => {
        e.preventDefault();
        $row.removeClass('attachment-queue-item-dragover');
        if (!dragSourceId) return;
        reorderQueueById(dragSourceId, id);
        renderQueueList();
    });
}

function reorderQueueById(sourceId, targetId) {
    const fromIndex = queue.findIndex(q => q.id === sourceId);
    const toIndex = queue.findIndex(q => q.id === targetId);
    if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return;
    const [moved] = queue.splice(fromIndex, 1);
    queue.splice(toIndex, 0, moved);
}

// ==========================================
// 初始化与事件绑定 (Init & Events)
// ==========================================

async function initAttachmentQueueRightMenu() {
    if ($(`#${RIGHT_MENU_ID}`).length) return;

    const $scrollInner = $('#right-nav-panel .scrollableInner');
    if (!$scrollInner.length) return;

    const blockHtml = `
        <div id="${RIGHT_MENU_ID}" class="right_menu" style="display: none;">
            <div class="right-nav-header flex-container flexGap5">
                <span class="attachment-queue-panel-title flex1">聊天队列</span>
            </div>
            <div class="right-nav-content">
                <div id="attachment_queue_dropzone" class="attachment-queue-dropzone">拖拽文件到这里</div>
                <div class="attachment-queue-main flex-container flexGap8">
                    <div id="attachment_queue_list" class="attachment-queue-list flex1"></div>
                    <div id="attachment_queue_preview" class="attachment-queue-preview flex1"></div>
                </div>
                <div id="attachment_queue_editor" class="attachment-queue-editor displayNone">
                    <textarea id="attachment_queue_text_input" class="attachment-queue-text-input" placeholder="输入文本..."></textarea>
                    <div class="flex-container flexGap5">
                        <button id="attachment_queue_save_text" class="menu_button">保存</button>
                        <button id="attachment_queue_cancel_text" class="menu_button">取消</button>
                    </div>
                </div>
            </div>
            <div class="right-nav-footer flex-container flexGap5">
                <button id="attachment_queue_add" class="menu_button menu_button_icon"><i class="fa-solid fa-plus"></i> 添加文件</button>
                <button id="attachment_queue_add_text" class="menu_button menu_button_icon"><i class="fa-solid fa-plus"></i> 新增楼层</button>
                <button id="attachment_queue_clear" class="menu_button menu_button_icon menu_button-danger"><i class="fa-solid fa-trash-can"></i> 清空</button>
                <span id="attachment_queue_status" class="attachment-queue-status flex1" style="text-align:right"></span>
            </div>
            <input id="attachment_queue_file_input" type="file" multiple class="displayNone" />
        </div>`;

    $scrollInner.append(blockHtml);

    const $block = $(`#${RIGHT_MENU_ID}`);
    const $dropZone = $block.find('#attachment_queue_dropzone');
    const $fileInput = $block.find('#attachment_queue_file_input');

    // 拖拽上传绑定
    $dropZone.on('dragenter dragover', (e) => { e.preventDefault(); $dropZone.addClass('attachment-queue-dropzone-hover'); });
    $dropZone.on('dragleave dragend drop', (e) => { e.preventDefault(); $dropZone.removeClass('attachment-queue-dropzone-hover'); });
    $dropZone.on('drop', (e) => {
        if (e.originalEvent.dataTransfer) addFilesToQueue(e.originalEvent.dataTransfer.files);
    });
    $dropZone.on('click', () => $fileInput.click());
    $fileInput.on('change', (e) => addFilesToQueue(e.target.files));

    // 按钮绑定
    $('#attachment_queue_add').click(() => $fileInput.click());
    $('#attachment_queue_add_text').click(() => {
        const id = addTextOnlyToQueue('');
        editTextItem(id);
    });
    $('#attachment_queue_clear').click(() => {
        queue = [];
        isRunning = false;
        renderQueueList();
        updateStatusText();
        updateSmartControlsVisibility();
    });

    $('#attachment_queue_save_text').click(() => {
        const $input = $('#attachment_queue_text_input');
        const id = $input.attr('data-edit-id');
        const item = queue.find(q => q.id === id);
        if (item) {
            item.text = $input.val();
            renderQueueList();
        }
        cancelEditTextItem();
    });
    $('#attachment_queue_cancel_text').click(cancelEditTextItem);

    updateStatusText();
}

function initAttachmentQueueSmartControls() {
    const $send = $('#send_but');
    if (!$send.length) return;
    if ($('#attachment_queue_play').length) return;

    const html = `
        <div id="attachment_queue_play" class="fa-solid fa-play interactable displayNone" title="开始队列"></div>
        <div id="attachment_queue_pause" class="fa-solid fa-pause interactable displayNone" title="暂停队列"></div>`;
    $(html).insertAfter($send);

    $('#attachment_queue_play').click(() => {
        const hasPending = queue.some(q => q.status === 'pending');
        if (!hasPending) {
            toastr.info('没有待发送的楼层');
            return;
        }
        isRunning = true;
        updateStatusText();
        updateSmartControlsVisibility();
        void processNext();
    });

    $('#attachment_queue_pause').click(() => {
        isRunning = false;
        updateStatusText();
        updateSmartControlsVisibility();
    });
    updateSmartControlsVisibility();
}

function updateSmartControlsVisibility() {
    const $play = $('#attachment_queue_play');
    const $pause = $('#attachment_queue_pause');
    if (!$play.length) return;

    const hasQueue = queue.length > 0;
    if (!hasQueue) {
        $play.addClass('displayNone');
        $pause.addClass('displayNone');
    } else if (isRunning) {
        $play.addClass('displayNone');
        $pause.removeClass('displayNone');
    } else {
        $play.removeClass('displayNone');
        $pause.addClass('displayNone');
    }
}

function initAttachmentQueueWandButton() {
    const $container = $('#attach_file_wand_container');
    if (!$container.length || $('#attachment_queue_wand_button').length) return;

    const html = `
        <div id="attachment_queue_wand_button" class="list-group-item flex-container flexGap5">
            <div class="fa-fw fa-solid fa-layer-group extensionsMenuExtensionButton"></div>
            <span>聊天队列</span>
        </div>`;

    const $attachBtn = $container.find('#attachFile');
    if ($attachBtn.length) $attachBtn.after(html);
    else $container.prepend(html);

    $('#attachment_queue_wand_button').click(async () => {
        await initAttachmentQueueRightMenu();
        toggleRightDrawer(RIGHT_MENU_ID);
        // 如果队列空，自动打开文件选择
        if (queue.length === 0) {
            $('#attachment_queue_file_input').click();
        }
    });
}

const toggleRightDrawer = (targetId) => {
    const $drawer = $('#right-nav-panel');
    const $content = $(`#${targetId}`);
    if ($content.is(':visible') && $drawer.hasClass('openDrawer')) {
        $drawer.removeClass('openDrawer').addClass('closedDrawer');
    } else {
        $('.right_menu').hide();
        $content.show();
        $drawer.removeClass('closedDrawer').addClass('openDrawer');
    }
    $(window).trigger('resize');
};

jQuery(() => {
    const entryPoint = async () => {
        if (window.st_chat_queue_loaded) return;
        window.st_chat_queue_loaded = true;
        console.log('🔥 Chat Queue: 启动中...');

        try { await initAttachmentQueueRightMenu(); } catch (e) {}
        initAttachmentQueueSmartControls();
        initAttachmentQueueWandButton();

        if (!$('#attachment_queue_icon').length) {
            const iconHtml = `<div id="attachment_queue_icon" class="drawer"><div class="drawer-toggle"><div class="drawer-icon fa-solid fa-layer-group fa-fw" title="聊天队列"></div></div></div>`;
            const $bg = $('#backgrounds-button');
            if ($bg.length) $(iconHtml).insertAfter($bg);
            else $('#top-settings-holder').append(iconHtml);

            $('#attachment_queue_icon .drawer-toggle').click(() => {
                if (!$(`#${RIGHT_MENU_ID}`).length) initAttachmentQueueRightMenu();
                toggleRightDrawer(RIGHT_MENU_ID);
            });
        }
    };

    // 暴力初始化：轮询直到关键DOM出现
    const poll = setInterval(() => {
        if ($('#send_but').length && $('#right-nav-panel').length) {
            clearInterval(poll);
            void entryPoint();
        }
    }, 1000);
});
