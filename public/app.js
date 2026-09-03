let ws = null;
let term = null;
let fitAddon = null;
let searchAddon = null;          // 🚀 T-4: 終端搜尋插件
let webLinksAddon = null;        // 🚀 T-4: 網址自動點選插件
let sftpWs = null;               // 單一 SFTP WebSocket 通道
let sftpUploadCancelled = false; // 是否取消傳輸標記
let activeConnectionId = null;   // 當前終端連線伺服器 ID
let sftpCurrentPath = '.';       // 當前檔案管理器絕對路徑
let sftpModalOpen = false;       // 檔案管理器彈窗開關狀態
let sftpFileChunks = [];         // 下載儲存區塊
let currentDownloadingFilename = ''; 
let uploadFile = null;           
let uploadOffset = 0;            
const uploadChunkSize = 64 * 1024;
let dragSourceEl = null;         
let savedScripts = [];           
let editingFilePath = '';        

// ==========================================
// 🔑 二進位轉碼輔助函數
// ==========================================
function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToArrayBuffer(base64) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

document.addEventListener("DOMContentLoaded", checkAuth);

// 1. 檢查驗證狀態
async function checkAuth() {
  try {
    const res = await fetch('/api/auth-check');
    const auth = await res.json();
    
    if (auth.version) {
      const versionStr = `v${auth.version}`;
      const verEl = document.getElementById('app-version');
      if (verEl) verEl.textContent = versionStr;
      const loginVerEl = document.getElementById('login-app-version');
      if (loginVerEl) loginVerEl.textContent = versionStr;
    }

    if (auth.required) {
      if (auth.authenticated) {
        document.getElementById('logout-btn').classList.remove('hidden');
        fetchConnections();
        fetchScripts();
      } else {
        showLoginOverlay();
      }
    } else {
      fetchConnections();
      fetchScripts();
    }
  } catch (err) {
    console.error("驗證檢查失敗:", err);
  }
}

function showLoginOverlay() {
  document.getElementById('login-overlay').classList.remove('hidden');
  document.getElementById('login-password').focus();
}

// 2. 登入提交
async function handleLogin(event) {
  event.preventDefault();
  const password = document.getElementById('login-password').value;
  const errorEl = document.getElementById('login-error');
  errorEl.classList.add('hidden');

  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      document.getElementById('login-overlay').classList.add('hidden');
      document.getElementById('logout-btn').classList.remove('hidden');
      fetchConnections();
      fetchScripts(); 
    } else {
      errorEl.textContent = data.error || '登入失敗';
      errorEl.classList.remove('hidden');
    }
  } catch (err) {
    errorEl.textContent = '連線錯誤，請稍後重試';
    errorEl.classList.remove('hidden');
  }
}

// 3. 登出
async function handleLogout() {
  try {
    await fetch('/api/logout', { method: 'POST' });
    document.getElementById('logout-btn').classList.add('hidden');
    document.getElementById('login-password').value = '';
    showLoginOverlay();
  } catch (err) {
    console.error("登出失敗:", err);
  }
}

// 4. 取得伺服器列表
async function fetchConnections() {
  try {
    const res = await fetch('/api/connections');
    if (res.status === 401) {
      showLoginOverlay();
      return;
    }
    const list = await res.json();
    const grid = document.getElementById('connections-grid');
    const empty = document.getElementById('empty-state');
    grid.innerHTML = '';

    if (list.length === 0) {
      empty.classList.remove('hidden');
      return;
    }
    empty.classList.add('hidden');

    list.forEach(conn => {
      const card = document.createElement('div');
      card.setAttribute('draggable', 'true');
      card.setAttribute('data-id', conn.id);
      card.className = "bg-slate-900 border border-slate-800 rounded-lg p-5 flex flex-col justify-between hover:border-slate-700 transition shadow-md cursor-grab active:cursor-grabbing group";
      
      card.addEventListener('dragstart', handleDragStart);
      card.addEventListener('dragover', handleDragOver);
      card.addEventListener('dragenter', handleDragEnter);
      card.addEventListener('dragleave', handleDragLeave);
      card.addEventListener('drop', handleDrop);
      card.addEventListener('dragend', handleDragEnd);

      card.innerHTML = `
        <div>
          <h3 class="text-lg font-bold text-slate-100 flex items-center justify-between">
            <span>${conn.name}</span>
            <svg class="w-4 h-4 text-slate-600 group-hover:text-slate-400 select-none" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M4 6h16M4 12h16M4 18h16"></path>
            </svg>
          </h3>
          <p class="text-sm text-slate-400 font-mono mt-1">${conn.username}@${conn.host}:${conn.port}</p>
        </div>
        <div class="mt-5 flex justify-end space-x-2">
          <button onclick="editConnection('${conn.id}', '${conn.name}', '${conn.host}', ${conn.port}, '${conn.username}', '${conn.authType}')" class="text-indigo-400 hover:text-indigo-300 px-3 py-1.5 text-sm transition">編輯</button>
          <button onclick="deleteConnection('${conn.id}')" class="text-rose-400 hover:text-rose-300 px-3 py-1.5 text-sm transition">刪除</button>
          <button onclick="connectSSH('${conn.id}', '${conn.name}')" class="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-1.5 rounded text-sm font-medium transition">連線</button>
        </div>
      `;
      grid.appendChild(card);
    });
  } catch (err) {
    console.error("無法取得伺服器列表:", err);
  }
}

// 拖拽排序
function handleDragStart(e) {
  this.style.opacity = '0.4';
  dragSourceEl = this;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', this.getAttribute('data-id'));
}
function handleDragOver(e) {
  if (e.preventDefault) e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  return false;
}
function handleDragEnter() { this.classList.add('border-emerald-500'); }
function handleDragLeave() { this.classList.remove('border-emerald-500'); }
async function handleDrop(e) {
  if (e.stopPropagation) e.stopPropagation();
  const targetId = this.getAttribute('data-id');
  const sourceId = e.dataTransfer.getData('text/plain');

  if (sourceId !== targetId) {
    const grid = document.getElementById('connections-grid');
    const cards = Array.from(grid.children);
    const sourceIdx = cards.findIndex(c => c.getAttribute('data-id') === sourceId);
    const targetIdx = cards.findIndex(c => c.getAttribute('data-id') === targetId);

    if (sourceIdx < targetIdx) grid.insertBefore(cards[sourceIdx], cards[targetIdx].nextSibling);
    else grid.insertBefore(cards[sourceIdx], cards[targetIdx]);

    await saveConnectionsOrder();
  }
  return false;
}
function handleDragEnd() {
  this.style.opacity = '1';
  Array.from(document.getElementById('connections-grid').children).forEach(c => c.classList.remove('border-emerald-500'));
}
async function saveConnectionsOrder() {
  const cards = Array.from(document.getElementById('connections-grid').querySelectorAll('[data-id]'));
  const order = cards.map(c => c.getAttribute('data-id'));
  try {
    await fetch('/api/connections/order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order })
    });
  } catch (_) {}
}

// 快速連線控制
function showQuickConnectModal() {
  const modal = document.getElementById('quick-connect-modal');
  if (!modal) return;
  const form = document.getElementById('quick-connect-form');
  if (form) form.reset();
  const portInput = document.getElementById('quick-port');
  if (portInput) portInput.value = '22';
  toggleQuickAuthType();
  modal.classList.remove('hidden');
  modal.classList.add('flex');
}
function hideQuickConnectModal() {
  const modal = document.getElementById('quick-connect-modal');
  if (modal) {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  }
}
function toggleQuickAuthType() {
  const selectEl = document.getElementById('quick-auth-type');
  if (!selectEl) return;
  const type = selectEl.value;
  const passField = document.getElementById('quick-password-field');
  const keyField = document.getElementById('quick-key-field');
  if (type === 'password') {
    if (passField) passField.classList.remove('hidden');
    if (keyField) keyField.classList.add('hidden');
  } else {
    if (passField) passField.classList.add('hidden');
    if (keyField) keyField.classList.remove('hidden');
  }
}

async function handleQuickConnect(event) {
  event.preventDefault();
  const host = document.getElementById('quick-host').value;
  const port = document.getElementById('quick-port').value;
  const username = document.getElementById('quick-username').value;
  const authType = document.getElementById('quick-auth-type').value;

  const body = { host, port, username };
  if (authType === 'password') {
    body.password = document.getElementById('quick-password').value;
  } else {
    body.privateKey = document.getElementById('quick-privatekey').value;
  }

  try {
    const res = await fetch('/api/quick-connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (res.status === 401) {
      hideQuickConnectModal();
      showLoginOverlay();
      return;
    }

    const data = await res.json();
    if (data.success && data.tempId) {
      hideQuickConnectModal();
      connectSSH(data.tempId, `⚡ 臨時連線 (${username}@${host})`);
    } else {
      alert(`連線建立失敗: ${data.error || '未知錯誤'}`);
    }
  } catch (err) {
    alert(`快速連線請求錯誤: ${err.message}`);
  }
}

function showAddModal() {
  document.getElementById('connection-form').reset();
  document.getElementById('conn-id').value = '';
  document.getElementById('modal-title').textContent = '新增連線設定';
  document.getElementById('modal').classList.remove('hidden');
  document.getElementById('modal').classList.add('flex');
  toggleAuthType();
}
function editConnection(id, name, host, port, username, authType) {
  document.getElementById('conn-id').value = id;
  document.getElementById('conn-name').value = name;
  document.getElementById('conn-host').value = host;
  document.getElementById('conn-port').value = port;
  document.getElementById('conn-username').value = username;
  document.getElementById('conn-auth-type').value = authType;
  document.getElementById('modal-title').textContent = '編輯連線設定';
  document.getElementById('conn-password').value = '';
  document.getElementById('conn-privatekey').value = '';
  document.getElementById('modal').classList.remove('hidden');
  document.getElementById('modal').classList.add('flex');
  toggleAuthType();
}
function hideModal() {
  document.getElementById('modal').classList.add('hidden');
  document.getElementById('modal').classList.remove('flex');
}
function toggleAuthType() {
  const type = document.getElementById('conn-auth-type').value;
  if (type === 'password') {
    document.getElementById('password-field').classList.remove('hidden');
    document.getElementById('key-field').classList.add('hidden');
  } else {
    document.getElementById('password-field').classList.add('hidden');
    document.getElementById('key-field').classList.remove('hidden');
  }
}

async function saveConnection(event) {
  event.preventDefault();
  const id = document.getElementById('conn-id').value;
  const name = document.getElementById('conn-name').value;
  const host = document.getElementById('conn-host').value;
  const port = document.getElementById('conn-port').value;
  const username = document.getElementById('conn-username').value;
  const authType = document.getElementById('conn-auth-type').value;

  const body = { id, name, host, port, username };
  if (authType === 'password') {
    const passwordVal = document.getElementById('conn-password').value;
    if (passwordVal || !id) { body.password = passwordVal; body.privateKey = ''; }
  } else {
    const privateKeyVal = document.getElementById('conn-privatekey').value;
    if (privateKeyVal || !id) { body.privateKey = privateKeyVal; body.password = ''; }
  }

  await fetch('/api/connections', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  hideModal();
  fetchConnections();
}

async function deleteConnection(id) {
  if (confirm('確定要刪除此伺服器連線配置嗎？')) {
    await fetch(`/api/connections/${id}`, { method: 'DELETE' });
    fetchConnections();
  }
}

// 拖放檔案上傳監聽
function initDragAndDrop(connectionId) {
  const screen = document.getElementById('terminal-screen');
  const dropzone = document.getElementById('dropzone-overlay');

  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
    screen.addEventListener(eventName, e => { e.preventDefault(); e.stopPropagation(); }, false);
  });

  screen.addEventListener('dragenter', () => { dropzone.classList.remove('hidden'); dropzone.classList.add('flex'); }, false);
  screen.addEventListener('dragover', () => { dropzone.classList.remove('hidden'); dropzone.classList.add('flex'); }, false);
  screen.addEventListener('dragleave', e => {
    if (e.relatedTarget === null || !screen.contains(e.relatedTarget)) {
      dropzone.classList.add('hidden');
      dropzone.classList.remove('flex');
    }
  }, false);

  screen.addEventListener('drop', e => {
    dropzone.classList.add('hidden');
    dropzone.classList.remove('flex');
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      if (!sftpWs || sftpWs.readyState !== WebSocket.OPEN) {
        toggleSftpModal();
        setTimeout(() => handleSftpUpload(connectionId, files[0]), 1200);
      } else {
        handleSftpUpload(connectionId, files[0]);
      }
    }
  }, false);
}

function triggerFileInput() { document.getElementById('sftp-file-input').click(); }
function handleFileSelect(event) {
  const files = event.target.files;
  if (files && files.length > 0 && activeConnectionId) {
    handleSftpUpload(activeConnectionId, files[0]);
    event.target.value = '';
  }
}

// ==========================================
// 🚀 T-3: 通用 SFTP 互動輸入彈窗控制器
// ==========================================
function openSftpPrompt(title, defaultValue, onConfirm) {
  const modal = document.getElementById('sftp-prompt-modal');
  document.getElementById('sftp-prompt-title').textContent = title;
  const input = document.getElementById('sftp-prompt-input');
  input.value = defaultValue || '';

  const confirmBtn = document.getElementById('sftp-prompt-confirm-btn');
  confirmBtn.onclick = () => {
    const val = input.value.trim();
    if (val) {
      closeSftpPrompt();
      onConfirm(val);
    }
  };

  input.onkeydown = e => {
    if (e.key === 'Enter') confirmBtn.click();
    else if (e.key === 'Escape') closeSftpPrompt();
  };

  modal.classList.remove('hidden');
  modal.classList.add('flex');
  input.focus();
}

function closeSftpPrompt() {
  const modal = document.getElementById('sftp-prompt-modal');
  modal.classList.add('hidden');
  modal.classList.remove('flex');
}

// 🚀 T-3: 新增資料夾
function sftpCreateFolder() {
  openSftpPrompt('📁 新建資料夾名稱', '', (folderName) => {
    if (!sftpWs || sftpWs.readyState !== WebSocket.OPEN) return;
    const targetPath = sftpCurrentPath === '/' ? `/${folderName}` : `${sftpCurrentPath}/${folderName}`;
    sftpWs.send(JSON.stringify({ action: 'mkdir', path: targetPath }));
  });
}

// 🚀 T-3: 新建空檔案
function sftpCreateFile() {
  openSftpPrompt('📄 新建檔案名稱 (如: test.txt)', '', (fileName) => {
    if (!sftpWs || sftpWs.readyState !== WebSocket.OPEN) return;
    const targetPath = sftpCurrentPath === '/' ? `/${fileName}` : `${sftpCurrentPath}/${fileName}`;
    sftpWs.send(JSON.stringify({ action: 'touch', path: targetPath }));
  });
}

// 🚀 T-3: 重新命名 / 移動
function sftpRenameItem(oldName) {
  openSftpPrompt(`✏️ 重新命名 "${oldName}"`, oldName, (newName) => {
    if (!sftpWs || sftpWs.readyState !== WebSocket.OPEN || newName === oldName) return;
    const oldPath = sftpCurrentPath === '/' ? `/${oldName}` : `${sftpCurrentPath}/${oldName}`;
    const newPath = sftpCurrentPath === '/' ? `/${newName}` : `${sftpCurrentPath}/${newName}`;
    sftpWs.send(JSON.stringify({ action: 'rename', oldPath, newPath }));
  });
}

// 🚀 T-3: 修改權限 (chmod)
function sftpChmodItem(name, currentPerms) {
  openSftpPrompt(`🔒 修改 "${name}" 權限 (八進位)`, currentPerms || '0755', (modeStr) => {
    if (!sftpWs || sftpWs.readyState !== WebSocket.OPEN) return;
    const targetPath = sftpCurrentPath === '/' ? `/${name}` : `${sftpCurrentPath}/${name}`;
    sftpWs.send(JSON.stringify({ action: 'chmod', path: targetPath, mode: modeStr }));
  });
}

// 🚀 T-3: 手動輸入路徑直接跳轉
function sftpPromptNavigate() {
  openSftpPrompt('🚀 輸入絕對路徑直接跳轉', sftpCurrentPath, (targetPath) => {
    sftpCurrentPath = targetPath.startsWith('/') ? targetPath : '/' + targetPath;
    refreshSftpList();
  });
}

// ==========================================
// 6. SFTP 通道建立 (🚀 T-1: In-Band 快速認證支援)
// ==========================================
function connectSftpWebSocket() {
  if (!activeConnectionId) return;
  const fileListContainer = document.getElementById('sftp-file-list');
  fileListContainer.innerHTML = '<div class="text-slate-500 text-center py-8">建立安全 SFTP 通道中...</div>';

  const protocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
  const isQuick = activeConnectionId.startsWith('temp:');
  // 🚀 T-1: 若為快速連線走 /sftp/quick，URL 零憑據
  const wsUrl = isQuick
    ? `${protocol}${window.location.host}/sftp/quick`
    : `${protocol}${window.location.host}/sftp/${activeConnectionId}`;

  sftpWs = new WebSocket(wsUrl);
  sftpWs.binaryType = 'arraybuffer';

  sftpWs.onopen = () => {
    sftpCurrentPath = '.';
    if (isQuick) {
      // 🚀 T-1: 第一幀 In-Band 發送認證 Token，徹底消滅 414 溢位
      sftpWs.send(JSON.stringify({ action: 'init', token: activeConnectionId }));
    }
    fileListContainer.innerHTML = '<div class="text-slate-500 text-center py-8">正在連線遠端伺服器 (SFTP)...</div>';
  };

  sftpWs.onmessage = async (event) => {
    if (event.data instanceof ArrayBuffer) {
      sftpFileChunks.push(event.data);
      sftpWs.send(JSON.stringify({ action: 'download_next' }));
      const downloadedBytes = sftpFileChunks.reduce((acc, chunk) => acc + chunk.byteLength, 0);
      document.getElementById('upload-progress-percent').textContent = '下載中...';
      document.getElementById('upload-progress-size').textContent = `${(downloadedBytes / 1024 / 1024).toFixed(2)} MB`;
      return;
    }

    try {
      const msg = JSON.parse(event.data);

      if (msg.status === 'error') {
        alert(`SFTP 操作失敗: ${msg.message}`);
        closeUploadOverlay();
        refreshSftpList();
        return;
      }

      if (msg.status === 'ready') {
        sftpWs.send(JSON.stringify({ action: 'list', path: sftpCurrentPath }));
      }
      else if (msg.status === 'list') {
        sftpCurrentPath = msg.path;
        updateBreadcrumbs(sftpCurrentPath); 
        renderSftpFiles(msg.files);
      }
      // 🚀 T-3: 各類操作成功回饋即時重整
      else if (msg.status === 'delete_ok' || msg.status === 'mkdir_ok' || msg.status === 'touch_ok' || msg.status === 'rename_ok' || msg.status === 'chmod_ok') {
        refreshSftpList();
      }
      else if (msg.status === 'upload_ready') {
        sendNextUploadChunk();
      }
      else if (msg.status === 'upload_ack') {
        handleUploadAck(msg.written);
      }
      else if (msg.status === 'upload_ok') {
        if (term) term.write(`\r\n[CF-WebSSH]: 檔案上傳成功！已儲存至 ${sftpCurrentPath}。\r\n`);
        closeUploadOverlay();
        refreshSftpList();
      }
      else if (msg.status === 'download_meta') {
        sftpFileChunks = [];
        currentDownloadingFilename = msg.filename;
        const uploadOverlay = document.getElementById('upload-overlay');
        document.getElementById('upload-file-info').textContent = `下載: ${currentDownloadingFilename}`;
        document.getElementById('upload-progress-bar').style.width = '100%';
        document.getElementById('upload-progress-percent').textContent = '開始下載...';
        document.getElementById('upload-progress-size').textContent = '0.00 MB';
        uploadOverlay.classList.remove('hidden');
        uploadOverlay.classList.add('flex');
        sftpWs.send(JSON.stringify({ action: 'download_next' }));
      }
      else if (msg.status === 'download_end') {
        const blob = new Blob(sftpFileChunks, { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = currentDownloadingFilename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        closeUploadOverlay();
      }
      else if (msg.status === 'file_read_ok') {
        if (editingFilePath === msg.path) {
          document.getElementById('editor-textarea').value = msg.content;
        }
      }
      else if (msg.status === 'file_write_ok') {
        if (term) term.write(`\r\n[CF-WebSSH]: 遠端檔案 "${msg.path.split('/').pop()}" 儲存成功！\r\n`);
        closeFileEditor();
        refreshSftpList();
      }
    } catch (e) {
      console.error("SFTP 解析失敗:", e);
    }
  };

  sftpWs.onerror = () => {
    fileListContainer.innerHTML = '<div class="text-rose-400 p-4 text-center">SFTP 通道連線失敗</div>';
  };
  sftpWs.onclose = () => {
    fileListContainer.innerHTML = '<div class="text-slate-500 p-4 text-center">SFTP 通道已關閉</div>';
  };
}

function disconnectSftpWebSocket() {
  if (sftpWs) { sftpWs.close(); sftpWs = null; }
}

function toggleSftpModal() {
  const modal = document.getElementById('sftp-modal');
  sftpModalOpen = !sftpModalOpen;
  if (sftpModalOpen) {
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    connectSftpWebSocket();
  } else {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
    disconnectSftpWebSocket();
  }
}

function refreshSftpList() {
  if (sftpWs && sftpWs.readyState === WebSocket.OPEN) {
    sftpWs.send(JSON.stringify({ action: 'list', path: sftpCurrentPath }));
  }
}

// 🚀 T-3: 渲染檔案清單（含八進位權限與完整操作按鈕）
function renderSftpFiles(files) {
  const fileListContainer = document.getElementById('sftp-file-list');
  fileListContainer.innerHTML = '';

  if (files.length === 0) {
    fileListContainer.innerHTML = '<div class="text-slate-500 text-center py-8">（此目錄為空）</div>';
    return;
  }

  files.forEach(file => {
    if (file.name === '.' || file.name === '..') return;

    const item = document.createElement('div');
    item.className = "flex items-center justify-between p-1.5 rounded hover:bg-slate-800 group transition duration-150";
    
    const icon = file.isDir ? '📁' : '📄';
    const sizeStr = file.isDir ? '' : ` (${(file.size / 1024).toFixed(1)} KB)`;
    const permBadge = file.permissions ? `<span class="text-[10px] text-slate-500 font-mono px-1 py-0.2 bg-slate-950 rounded border border-slate-800 mr-1 select-none" title="Linux 權限模式">${file.permissions}</span>` : '';
    
    const info = document.createElement('div');
    info.className = `flex items-center gap-1.5 truncate flex-1 ${file.isDir ? 'text-amber-400 font-bold cursor-pointer hover:underline' : 'text-slate-300'}`;
    info.innerHTML = `<span>${icon}</span>${permBadge}<span class="truncate" title="${file.name}">${file.name}${sizeStr}</span>`;
    
    if (file.isDir) {
      info.onclick = () => {
        sftpCurrentPath = sftpCurrentPath === '/' ? `/${file.name}` : `${sftpCurrentPath}/${file.name}`;
        refreshSftpList();
      };
    }

    const actions = document.createElement('div');
    actions.className = "flex items-center space-x-1 opacity-0 group-hover:opacity-100 transition duration-150 pl-2";
    
    // 編輯
    if (!file.isDir && isEditableTextFile(file.name)) {
      const editBtn = document.createElement('button');
      editBtn.className = "text-amber-400 hover:text-amber-300 bg-slate-950 px-1.5 py-0.5 rounded text-[10px] font-medium border border-slate-800";
      editBtn.textContent = '編輯';
      editBtn.onclick = (e) => { e.stopPropagation(); sftpOpenFileEditor(file.name); };
      actions.appendChild(editBtn);
    }

    // 下載
    if (!file.isDir) {
      const dlBtn = document.createElement('button');
      dlBtn.className = "text-emerald-400 hover:text-emerald-300 bg-slate-950 px-1.5 py-0.5 rounded text-[10px] font-medium border border-slate-800";
      dlBtn.textContent = '下載';
      dlBtn.onclick = (e) => { e.stopPropagation(); sftpDownloadFile(file.name); };
      actions.appendChild(dlBtn);
    }

    // 🚀 T-3: 重新命名
    const renameBtn = document.createElement('button');
    renameBtn.className = "text-sky-400 hover:text-sky-300 bg-slate-950 px-1.5 py-0.5 rounded text-[10px] font-medium border border-slate-800";
    renameBtn.textContent = '更名';
    renameBtn.onclick = (e) => { e.stopPropagation(); sftpRenameItem(file.name); };
    actions.appendChild(renameBtn);

    // 🚀 T-3: 權限 (chmod)
    const chmodBtn = document.createElement('button');
    chmodBtn.className = "text-purple-400 hover:text-purple-300 bg-slate-950 px-1.5 py-0.5 rounded text-[10px] font-medium border border-slate-800";
    chmodBtn.textContent = '權限';
    chmodBtn.onclick = (e) => { e.stopPropagation(); sftpChmodItem(file.name, file.permissions); };
    actions.appendChild(chmodBtn);

    // 刪除
    const delBtn = document.createElement('button');
    delBtn.className = "text-rose-400 hover:text-rose-300 bg-slate-950 px-1.5 py-0.5 rounded text-[10px] font-medium border border-slate-800";
    delBtn.textContent = '刪除';
    delBtn.onclick = (e) => { e.stopPropagation(); sftpDeleteFile(file.name, file.isDir); };
    actions.appendChild(delBtn);

    item.appendChild(info);
    item.appendChild(actions);
    fileListContainer.appendChild(item);
  });
}

function isEditableTextFile(filename) {
  const ext = filename.split('.').pop().toLowerCase();
  const textExts = ['txt', 'conf', 'env', 'sh', 'yml', 'yaml', 'json', 'py', 'js', 'css', 'html', 'xml', 'md', 'ini', 'cfg', 'log', 'htaccess', 'svg'];
  return !filename.includes('.') || textExts.includes(ext);
}

function sftpOpenFileEditor(filename) {
  if (!sftpWs || sftpWs.readyState !== WebSocket.OPEN) return;
  editingFilePath = sftpCurrentPath === '/' ? `/${filename}` : `${sftpCurrentPath}/${filename}`;
  document.getElementById('editor-file-title').textContent = `📝 編輯遠端檔案: ${editingFilePath}`;
  document.getElementById('editor-textarea').value = '遠端讀取中，請稍候...';
  const editorModal = document.getElementById('editor-modal');
  editorModal.classList.remove('hidden');
  editorModal.classList.add('flex');
  sftpWs.send(JSON.stringify({ action: 'file_read', path: editingFilePath }));
}

function closeFileEditor() {
  document.getElementById('editor-modal').classList.add('hidden');
  document.getElementById('editor-modal').classList.remove('flex');
  editingFilePath = '';
}

function saveRemoteFile() {
  if (!sftpWs || sftpWs.readyState !== WebSocket.OPEN || !editingFilePath) return;
  const content = document.getElementById('editor-textarea').value;
  sftpWs.send(JSON.stringify({ action: 'file_write', path: editingFilePath, content }));
}

function updateBreadcrumbs(path) {
  const container = document.getElementById('sftp-breadcrumbs');
  container.innerHTML = '';
  const normalizedPath = path.startsWith('/') ? path : '/' + path;
  const parts = normalizedPath.split('/').filter(p => p.length > 0);

  const rootSpan = document.createElement('span');
  rootSpan.className = "text-emerald-400 hover:text-emerald-300 hover:underline cursor-pointer font-bold flex items-center";
  rootSpan.innerHTML = `🏠 /`;
  rootSpan.onclick = () => { sftpCurrentPath = '/'; refreshSftpList(); };
  container.appendChild(rootSpan);

  let currentBuildPath = '';
  parts.forEach((part, index) => {
    currentBuildPath += '/' + part;
    const targetPath = currentBuildPath; 
    const partSpan = document.createElement('span');
    if (index === parts.length - 1) {
      partSpan.className = "text-slate-200 font-bold px-0.5 select-all";
    } else {
      partSpan.className = "text-emerald-400 hover:text-emerald-300 hover:underline cursor-pointer px-0.5";
      partSpan.onclick = () => { sftpCurrentPath = targetPath; refreshSftpList(); };
    }
    partSpan.textContent = part + (index === parts.length - 1 ? '' : ' /');
    container.appendChild(partSpan);
  });
}

function sftpGoUp() {
  if (sftpCurrentPath === '/' || sftpCurrentPath === '.') return;
  const parts = sftpCurrentPath.split('/');
  parts.pop();
  sftpCurrentPath = parts.join('/') || '/';
  refreshSftpList();
}

function sftpDownloadFile(filename) {
  if (!sftpWs || sftpWs.readyState !== WebSocket.OPEN) return;
  const targetPath = sftpCurrentPath === '/' ? `/${filename}` : `${sftpCurrentPath}/${filename}`;
  sftpWs.send(JSON.stringify({ action: 'download_start', path: targetPath }));
}

function sftpDeleteFile(filename, isDir) {
  if (!sftpWs || sftpWs.readyState !== WebSocket.OPEN) return;
  const typeStr = isDir ? '資料夾' : '檔案';
  if (!confirm(`確定要永久刪除此${typeStr}嗎？ (${filename})`)) return;
  const targetPath = sftpCurrentPath === '/' ? `/${filename}` : `${sftpCurrentPath}/${filename}`;
  sftpWs.send(JSON.stringify({ action: 'delete', path: targetPath, isDir }));
}

function handleSftpUpload(connectionId, file) {
  if (!sftpWs || sftpWs.readyState !== WebSocket.OPEN) {
    alert('SFTP 安全通道尚未就緒，請重試。');
    return;
  }
  sftpUploadCancelled = false;
  uploadFile = file;
  uploadOffset = 0;

  const uploadOverlay = document.getElementById('upload-overlay');
  document.getElementById('upload-file-info').textContent = `上傳: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`;
  document.getElementById('upload-progress-bar').style.width = '0%';
  document.getElementById('upload-progress-percent').textContent = '0%';
  document.getElementById('upload-progress-size').textContent = `0.00 / ${(file.size / 1024 / 1024).toFixed(2)} MB`;

  uploadOverlay.classList.remove('hidden');
  uploadOverlay.classList.add('flex');

  const targetPath = sftpCurrentPath === '/' ? `/${file.name}` : `${sftpCurrentPath}/${file.name}`;
  sftpWs.send(JSON.stringify({ action: 'upload_start', filename: file.name, path: targetPath }));
}

function sendNextUploadChunk() {
  const nextSize = Math.min(uploadChunkSize, uploadFile.size - uploadOffset);
  const slice = uploadFile.slice(uploadOffset, uploadOffset + nextSize);
  const reader = new FileReader();
  reader.onload = (e) => {
    if (sftpWs && sftpWs.readyState === WebSocket.OPEN) {
      sftpWs.send(e.target.result); 
    }
  };
  reader.readAsArrayBuffer(slice);
}

function handleUploadAck(written) {
  if (sftpUploadCancelled) return;
  uploadOffset += written;
  const percent = Math.min(100, Math.floor((uploadOffset / uploadFile.size) * 100));
  document.getElementById('upload-progress-bar').style.width = `${percent}%`;
  document.getElementById('upload-progress-percent').textContent = `${percent}%`;
  document.getElementById('upload-progress-size').textContent = `${(uploadOffset / 1024 / 1024).toFixed(2)} / ${(uploadFile.size / 1024 / 1024).toFixed(2)} MB`;

  if (uploadOffset < uploadFile.size) sendNextUploadChunk();
  else sftpWs.send(JSON.stringify({ action: 'upload_end' }));
}

function cancelUpload() {
  sftpUploadCancelled = true;
  if (sftpWs && sftpWs.readyState === WebSocket.OPEN) {
    sftpWs.send(JSON.stringify({ action: 'upload_cancel' }));
  }
  closeUploadOverlay();
  if (term) term.write(`\r\n[CF-WebSSH]: 使用者手動取消了傳輸工作。\r\n`);
  refreshSftpList();
}

function closeUploadOverlay() {
  document.getElementById('upload-overlay').classList.add('hidden');
  document.getElementById('upload-overlay').classList.remove('flex');
  uploadFile = null;
}

// 常用腳本
async function fetchScripts() {
  try {
    const res = await fetch('/api/scripts');
    if (res.status === 401) { showLoginOverlay(); return; }
    savedScripts = await res.json(); 
    renderScriptsList(savedScripts);
    populateTerminalScriptsDropdown(savedScripts);
  } catch (_) {}
}

function renderScriptsList(list) {
  const container = document.getElementById('scripts-list');
  container.innerHTML = '';
  if (list.length === 0) {
    container.innerHTML = '<div class="text-slate-500 text-center py-12">目前無儲存的常用腳本，可在上方新增。</div>';
    return;
  }
  list.forEach(scr => {
    const item = document.createElement('div');
    item.className = "bg-slate-950 border border-slate-800 rounded p-3 flex justify-between items-center gap-4";
    item.innerHTML = `
      <div class="truncate flex-1">
        <h4 class="font-bold text-slate-100">${scr.name}</h4>
        <p class="text-[11px] text-slate-400 font-mono mt-0.5 truncate">${scr.content}</p>
      </div>
      <button onclick="deleteScript('${scr.id}')" class="text-rose-500 hover:text-rose-400 px-2 py-1 text-xs">刪除</button>
    `;
    container.appendChild(item);
  });
}

function populateTerminalScriptsDropdown(list) {
  const select = document.getElementById('terminal-script-select');
  select.innerHTML = '<option value="" disabled selected>📜 常用腳本...</option>';
  list.forEach(scr => {
    const opt = document.createElement('option');
    opt.value = scr.content;
    opt.textContent = scr.name;
    select.appendChild(opt);
  });
}

function showScriptsModal() {
  document.getElementById('script-form').reset();
  document.getElementById('scripts-modal').classList.remove('hidden');
  document.getElementById('scripts-modal').classList.add('flex');
  fetchScripts();
}
function hideScriptsModal() {
  document.getElementById('scripts-modal').classList.add('hidden');
  document.getElementById('scripts-modal').classList.remove('flex');
}

async function saveScript(event) {
  event.preventDefault();
  const name = document.getElementById('script-name').value;
  const content = document.getElementById('script-content').value;
  const tempId = crypto.randomUUID(); 
  savedScripts.push({ id: tempId, name, content });
  renderScriptsList(savedScripts);
  populateTerminalScriptsDropdown(savedScripts);
  document.getElementById('script-form').reset();

  try {
    await fetch('/api/scripts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: tempId, name, content })
    });
  } catch (_) {}
}

async function deleteScript(id) {
  if (!confirm('確定要刪除此常用腳本嗎？')) return;
  savedScripts = savedScripts.filter(s => s.id !== id);
  renderScriptsList(savedScripts);
  populateTerminalScriptsDropdown(savedScripts);
  try { await fetch(`/api/scripts/${id}`, { method: 'DELETE' }); } catch (_) {}
}

function runSelectedScript(selectElement) {
  const command = selectElement.value;
  if (command && ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'data', data: command + '\r' }));
    selectElement.value = ''; 
  }
}

// 密鑰生成器
async function generateSshKey(e) {
  const btn = e ? e.target : null;
  if (btn) { btn.disabled = true; btn.textContent = '生成中...'; }
  const algo = document.getElementById('keygen-algorithm-select').value;
  
  try {
    let keyPair = null;
    let pubPemStr = '';
    let privPem = '';

    if (algo === 'ed25519') {
      keyPair = await window.crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
      privPem = derToPem(await window.crypto.subtle.exportKey("pkcs8", keyPair.privateKey), "PRIVATE KEY");
      const pubDer = await window.crypto.subtle.exportKey("spki", keyPair.publicKey);
      const rawPubKey = new Uint8Array(pubDer).slice(-32);
      const sshBytes = new Uint8Array(51);
      sshBytes[3] = 11;
      sshBytes.set(new TextEncoder().encode("ssh-ed25519"), 4);
      sshBytes[18] = 32;
      sshBytes.set(rawPubKey, 19);
      pubPemStr = `ssh-ed25519 ${btoa(String.fromCharCode(...sshBytes))} cf-webssh-keygen`;
    } else if (algo === 'rsa-2048' || algo === 'rsa-4096') {
      const size = algo === 'rsa-2048' ? 2048 : 4096;
      keyPair = await window.crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: size, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
      privPem = derToPem(await window.crypto.subtle.exportKey("pkcs8", keyPair.privateKey), "PRIVATE KEY");
      pubPemStr = formatOpenSshRsa(await window.crypto.subtle.exportKey("jwk", keyPair.publicKey));
    } else if (algo === 'ecdsa') {
      keyPair = await window.crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
      privPem = derToPem(await window.crypto.subtle.exportKey("pkcs8", keyPair.privateKey), "PRIVATE KEY");
      pubPemStr = formatOpenSshEcdsa(await window.crypto.subtle.exportKey("jwk", keyPair.publicKey));
    }

    document.getElementById('keygen-pubkey').value = pubPemStr;
    document.getElementById('keygen-privkey').value = privPem;
    document.getElementById('key-gen-result').classList.remove('hidden');
  } catch (err) {
    alert(`密鑰生成失敗: ${err.message}`);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '一鍵生成安全密鑰'; }
  }
}

function formatOpenSshRsa(jwk) {
  const typeBytes = new TextEncoder().encode("ssh-rsa");
  const eBytes = base64urlToBytes(jwk.e);
  let nBytes = base64urlToBytes(jwk.n);
  if (nBytes[0] & 0x80) {
    const tmp = new Uint8Array(nBytes.length + 1);
    tmp.set(nBytes, 1);
    nBytes = tmp;
  }
  const part1 = writeLengthPrefixed(typeBytes);
  const part2 = writeLengthPrefixed(eBytes);
  const part3 = writeLengthPrefixed(nBytes);
  const combined = new Uint8Array(part1.byteLength + part2.byteLength + part3.byteLength);
  combined.set(part1, 0);
  combined.set(part2, part1.byteLength);
  combined.set(part3, part1.byteLength + part2.byteLength);
  return `ssh-rsa ${arrayBufferToBase64(combined)} cf-webssh-keygen`;
}

function formatOpenSshEcdsa(jwk) {
  const typeBytes = new TextEncoder().encode("ecdsa-sha2-nistp256");
  const curveBytes = new TextEncoder().encode("nistp256");
  const xBytes = base64urlToBytes(jwk.x);
  const yBytes = base64urlToBytes(jwk.y);
  const qBytes = new Uint8Array(65);
  qBytes[0] = 0x04;
  qBytes.set(xBytes, 1);
  qBytes.set(yBytes, 33);
  const part1 = writeLengthPrefixed(typeBytes);
  const part2 = writeLengthPrefixed(curveBytes);
  const part3 = writeLengthPrefixed(qBytes);
  const combined = new Uint8Array(part1.byteLength + part2.byteLength + part3.byteLength);
  combined.set(part1, 0);
  combined.set(part2, part1.byteLength);
  combined.set(part3, part1.byteLength + part2.byteLength);
  return `ecdsa-sha2-nistp256 ${arrayBufferToBase64(combined)} cf-webssh-keygen`;
}

function base64urlToBytes(b64url) {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64.padEnd(b64.length + (4 - b64.length % 4) % 4, '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function writeLengthPrefixed(bytes) {
  const len = bytes.byteLength;
  const lenBytes = new Uint8Array(4);
  lenBytes[0] = (len >> 24) & 0xFF;
  lenBytes[1] = (len >> 16) & 0xFF;
  lenBytes[2] = (len >> 8) & 0xFF;
  lenBytes[3] = len & 0xFF;
  const combined = new Uint8Array(4 + len);
  combined.set(lenBytes, 0);
  combined.set(bytes, 4);
  return combined;
}

function derToPem(derBuffer, label) {
  const base64 = arrayBufferToBase64(derBuffer);
  const lines = base64.match(/.{1,64}/g).join('\n');
  return `-----BEGIN ${label}-----\n${lines}\n-----END ${label}-----`;
}

function copyToClipboard(elementId) {
  const el = document.getElementById(elementId);
  el.select();
  document.execCommand('copy');
  alert('已成功複製到剪貼簿！');
}

// ==========================================
// 🚀 T-4: 終端搜尋控制函數
// ==========================================
function toggleTerminalSearch() {
  const bar = document.getElementById('terminal-search-bar');
  if (!bar) return;
  const isHidden = bar.classList.contains('hidden');
  if (isHidden) {
    bar.classList.remove('hidden');
    bar.classList.add('flex');
    const input = document.getElementById('terminal-search-input');
    input.focus();
    input.select();
  } else {
    bar.classList.add('hidden');
    bar.classList.remove('flex');
    if (searchAddon && searchAddon.clearDecorations) searchAddon.clearDecorations();
    if (term) term.focus();
  }
}

function findNext() {
  const q = document.getElementById('terminal-search-input').value;
  if (q && searchAddon) searchAddon.findNext(q);
}

function findPrev() {
  const q = document.getElementById('terminal-search-input').value;
  if (q && searchAddon) searchAddon.findPrevious(q);
}

function handleSearchKeydown(e) {
  if (e.key === 'Enter') {
    if (e.shiftKey) findPrev();
    else findNext();
  } else if (e.key === 'Escape') {
    toggleTerminalSearch();
  }
}

// ==========================================
// 終端機連線 (🚀 T-1: In-Band 快速認證 + 🚀 T-4 插件加載)
// ==========================================
function connectSSH(id, name) {
  activeConnectionId = id; 
  document.getElementById('active-terminal-title').textContent = `連線至: ${name}`;
  document.getElementById('terminal-screen').classList.remove('hidden');
  document.getElementById('terminal-screen').classList.add('flex');

  initDragAndDrop(id);

  // 🚀 T-5 & T-4: 建立終端與加載外掛 (Zero-CDN)
  term = new window.Terminal({
    cursorBlink: true,
    fontFamily: 'Courier New, Courier, monospace',
    fontSize: 14,
    theme: {
      background: '#020617',
      foreground: '#f8fafc',
      cursor: '#10b981'
    }
  });

  fitAddon = new (window.FitAddon?.FitAddon || window.FitAddon)();
  searchAddon = new (window.SearchAddon?.SearchAddon || window.SearchAddon)();
  webLinksAddon = new (window.WebLinksAddon?.WebLinksAddon || window.WebLinksAddon)();

  term.loadAddon(fitAddon);
  term.loadAddon(searchAddon);
  term.loadAddon(webLinksAddon);

  term.open(document.getElementById('terminal-container'));
  fitAddon.fit();
  term.focus(); 

  // 快捷鍵: Ctrl+Shift+F 喚起搜尋
  term.attachCustomKeyEventHandler(e => {
    if (e.ctrlKey && e.shiftKey && (e.key === 'F' || e.key === 'f')) {
      toggleTerminalSearch();
      return false;
    }
    return true;
  });

  const protocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
  const isQuick = id.startsWith('temp:');
  
  // 🚀 T-1: 若為快速連線，URL 走簡短的 /ssh/quick，完全不攜帶長私鑰憑據！
  const wsUrl = isQuick
    ? `${protocol}${window.location.host}/ssh/quick`
    : `${protocol}${window.location.host}/ssh/${id}`;

  ws = new WebSocket(wsUrl);
  ws.binaryType = 'arraybuffer';

  ws.onopen = () => {
    if (isQuick) {
      // 🚀 T-1: 第一幀發送認證 Token，徹底消滅 414 URL 超長崩潰
      ws.send(JSON.stringify({ type: 'init', token: id }));
    }
    if (term) {
      term.write('\r\n[CF-WebSSH]: 已建立安全通道，正在連線遠端伺服器...\r\n');
    }
    ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
  };

  ws.onmessage = (event) => {
    if (!term) return;
    if (event.data instanceof ArrayBuffer) term.write(new Uint8Array(event.data));
    else term.write(event.data);
  };

  ws.onclose = () => {
    if (term) term.write('\r\n[CF-WebSSH]: 連線已中斷。\r\n');
  };

  term.onData(data => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'data', data }));
    }
  });

  window.addEventListener('resize', onWindowResize);
}

function onWindowResize() {
  if (fitAddon && term) {
    fitAddon.fit();
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
    }
  }
}

function closeTerminal() {
  if (sftpModalOpen) toggleSftpModal();
  activeConnectionId = null; 
  window.removeEventListener('resize', onWindowResize);
  const searchBar = document.getElementById('terminal-search-bar');
  if (searchBar) {
    searchBar.classList.add('hidden');
    searchBar.classList.remove('flex');
  }
  if (ws) { ws.close(); ws = null; }
  if (term) { term.dispose(); term = null; }
  document.getElementById('terminal-screen').classList.add('hidden');
  document.getElementById('terminal-screen').classList.remove('flex');
}

function showKeygenModal() {
  document.getElementById('key-gen-result').classList.add('hidden');
  document.getElementById('keygen-pubkey').value = '';
  document.getElementById('keygen-privkey').value = '';
  document.getElementById('keygen-modal').classList.remove('hidden');
  document.getElementById('keygen-modal').classList.add('flex');
}
function hideKeygenModal() {
  document.getElementById('keygen-modal').classList.add('hidden');
  document.getElementById('keygen-modal').classList.remove('flex');
}
