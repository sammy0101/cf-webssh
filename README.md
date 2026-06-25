# cf-webssh

一個基於 Cloudflare Workers 平台構建的輕量級、模組化 WebSSH 終端與 SFTP 遠端檔案管理工作台。

本專案利用 Cloudflare 原生 TCP 接口（透過相容性標誌 `nodejs_compat` 啟用 `cloudflare:sockets`）與遠端主機建立安全的 SSH 通道，並在瀏覽器前端提供高互動性的終端體驗（`xterm.js`）、視覺化 SFTP 檔案管理器、遠端檔案線上編輯器，以及本地安全密鑰生成器。

## 🎯 專案特點

- **無伺服器架構**：完全依賴 Cloudflare Workers 邊緣網路，無需部署與維護傳統的 WebSSH 後端伺服器（如 Bastion、Guacamole 等）。
- **模組化與解耦設計（全新）**：
  - 本地開發完全解耦為獨立檔案：安全加密（`crypto.js`）、終端通訊（`ssh.js`）、SFTP 管理（`sftp.js`）、主入口（`index.js`），以及前端 HTML 骨架與前端控制腳本（`app.js`）。
  - **高效打包**：利用 `build.mjs` 中自訂的 `clientJsLoaderPlugin` 解析器，在編譯時將前端代碼以靜態字串自動打包併入單一的 Workers 部署檔中，在維持本地開發高維護性的同時，保有單一 Workers 部署的高效能。
- **全庫零知識（Zero-Knowledge）端到端對稱加密**：
  - 當設定管理員密碼（環境變數 `ADMIN_PASSWORD`）時，系統會自動在 Worker 記憶體中利用您的密碼雜湊衍生出 256 位元的對稱金鑰。
  - 主機連線欄位（包括主機 IP/域名、主機名稱、端口、使用者名稱、連線密碼與私鑰）在寫入 Cloudflare KV 前，**皆全數透過原生 WebCrypto API 執行強度的 AES-GCM-256 對稱加密**。
  - **安全性**：即便 Cloudflare 帳戶或 KV 資料庫整庫被導出洩漏，攻擊者也完全無法得知您管理的 VPS 名稱、IP 位置與登入帳密。
  - **向下相容**：系統具備智慧判定，若偵測到未加密的舊有資料會自動以明文格式讀取，不影響您原先已儲存的配置。您只需在網頁上對舊主機點選「編輯 -> 儲存」，系統便會自動將其無損升級為加密狀態。
- **一體化 SFTP 遠端檔案管理器**：
  - 前端頂部整合為單一 **「📁 SFTP 檔案管理」** 彈窗視窗，可直接在終端機畫面上方彈出，體驗一體化。
  - **📝 遠端檔案線上編輯器（全新）**：點選文字格式檔案（如 `.conf`、`.sh`、`.env`、`.json`、`.yml` 等）旁的 **「編輯」** 按鈕，右側會直接拉出一個大面積的代碼編輯器彈窗，修改後點擊「儲存變更」即可即時覆寫寫入 VPS，免去使用終端機 `vim` / `nano` 的繁瑣步驟。
  - **「類 Windows」麵包屑導航**：自動將目前的絕對路徑分割為可點選的級聯節點（如 `🏠 / root / apps`），點選即可快速跨目錄跳轉。
  - **檔案瀏覽與導航**：點選資料夾可直接進入，支援目錄深層導航、向上返回與重新整理。
  - **檔案下載與完整性流控制（Backpressure）**：採用 Web 串流控制，發送一塊數據確認一塊，絕不撐爆 Worker 記憶體，支援超大檔案的安全流式下載。
  - **拖放與手動上傳**：支援將電腦檔案直接拖曳至終端機畫面上傳，或點選視窗內的「上傳檔案」手動選取，自動上傳至目前瀏覽的目錄中。
  - **檔案刪除**：支援一鍵永久刪除遠端 VPS 上的檔案或空資料夾。
- **內建多算法安全 SSH 密鑰生成器（全新）**：
  - 主畫面 Header 新增獨立的 **「🔑 密鑰生成」** 彈窗。完全由瀏覽器端 WebCrypto 引擎本地生成，保證極限物理安全。
  - **支援四種主流算法**：`ED25519` (高安全、推薦)、`RSA-2048` (高相容)、`RSA-4096` (極高安全)、`ECDSA P-256` (橢圓曲線)。
  - **標準公鑰序列化編譯**：內建 OpenSSH 公鑰字節序列化解析器，自動將 DER 編碼編譯成可以直接寫入 Linux `authorized_keys` 的標準 `ssh-rsa` 或 `ecdsa-sha2-nistp256` 等明文字串，一鍵複製使用。
- **自訂一鍵常用腳本與即時注入**：
  - 主畫面新增 **「📜 常用腳本」** 管理彈窗，提供視覺化新增與刪除自訂腳本（如系統更新、Docker 狀態檢視等）。
  - **一鍵終端機注入**：當您在 SSH 連線中，點擊頂部 **「📜 常用腳本...」** 下拉選單，對應的指令將即時輸入到您的終端中並自動送出執行。
  - **明文儲存**：常用腳本指令在 KV 中以純文字 JSON 格式儲存，便於您在 Cloudflare 後台直接檢視。
- **免延遲樂觀更新機制 (Optimistic UI Updates)**：
  - 由於 Cloudflare KV 的寫入具有「最終一致性」的延遲（寫入後通常需要 1~3 秒才會在全球節點生效），原先新增腳本後可能無法立刻在畫面上重新整理出來。
  - 本專案實作了**樂觀更新技術**：前端在內存中維護最新的腳本快取，新增/刪除時會在 0 毫秒內立刻反應在介面上，背景則由異步靜默向後端 KV 進行儲存，帶來極速、無延遲的流暢體驗。
- **原生 HTML5 卡片拖曳排序**：
  - 主畫面的伺服器卡片具備拖拽手把（右上角三橫線圖示），滑鼠指過去會自動變更為抓取手勢（`cursor-grab`）。
  - **拖拽與保存**：您可以隨意拖動卡片重新排序，落點處會具備高亮邊框指示。當放開滑鼠時，新順序陣列會自動異步儲存至 KV 上的 `connections_order` 清單中，永久保存您的自訂卡片順序。
- **優雅的系統圖示與 LOGO**：
  - **網站 Favicon**：採用動態嵌入的 SVG Data-URI 技術，完美替換分頁標籤上的地球預設圖標。
  - **主視覺 LOGO**：主畫面與登入介面皆整合了極具現代感的終端機游標圖示（`>_`）。
- **優化的 xterm.js 終端**：
  - **自動聚焦 (Auto Focus)**：連線載入完成後自動鎖定焦點，無需手動用滑鼠點擊即可直接開始打字輸入。
  - **視窗尺寸動態同步**：支援瀏覽器視窗縮放時，自動向遠端虛擬終端（Pseudo-terminal, PTY）發送 `resize` 訊號。

## 📁 專案目錄結構

```text
cf-webssh/
├── wrangler.toml              # Cloudflare Wrangler 配置文件
├── package.json               # 項目與套件依賴配置
├── build.mjs                  # esbuild 自訂構建與打包指令碼 (含解耦插件)
├── mocks/
│   └── cpu-features.js        # cpu-features 機制模擬器
├── public/
│   ├── index.html             # 前台純淨 HTML 排版模版
│   └── app.js                 # 🆕 獨立的前台 JavaScript 核心控制器
└── src/
    ├── crypto.js              # 🆕 獨立的對稱加密模組 (AES-GCM-256)
    ├── ssh.js                 # 🆕 獨立的 SSH 終端通訊模組
    ├── sftp.js                # 🆕 獨立的 SFTP 管理通訊模組
    └── index.js               # 🆕 後端主路由與分發器 (精簡解耦)
```

## ⚙️ 系統需求

- [Cloudflare 帳戶](https://dash.cloudflare.com/)
- [Node.js](https://nodejs.org/) (建議使用 v18.0.0 以上之版本)

## 🚀 部署指南

### 方法 A：透過 GitHub Actions 自動部署（推薦）

本專案已內建完整的 CI/CD 自動化工作流。當您將專案推送到 GitHub 的 `main` 分支時，系統將會**全自動處理 KV 命名空間**：

1. **Fork 本項目**。
2. 在 GitHub 專案的 `Settings -> Secrets and variables -> Actions` 中，新增一個名為 `CLOUDFLARE_API_TOKEN` 的 Secret（此 Token 需具備編輯 Workers 與 KV 命名空間的權限）。
3. 將代碼推送至 `main` 分支。
4. GitHub Actions 工作流（`.github/workflows/deploy.yml`）會自動偵測您的 Cloudflare 帳戶中是否已存在 `WEBSSH_KV` 命名空間。若不存在，將自動為您建立，並**自動動態填入** `wrangler.toml` 中的 `KV_NAMESPACE_ID_PLACEHOLDER`，最後完成編譯與部署。您無需進行任何手動文件修改。

> 💡 **如何在使用 GitHub Actions 部署時設置登入密碼與 AES 加密金鑰？**
> 請直接登入 [Cloudflare Dashboard](https://dash.cloudflare.com/)，進入您的 Workers 項目，點選 `Settings` -> `Variables` -> `Environment Variables`，手動新增變數 `ADMIN_PASSWORD`。為了安全起見，請務必將其儲存類型設為 **Encrypt (Secret)**。此密碼一經儲存，除了用於登入外，還會自動在後端作為 AES-GCM 金鑰。

---

### 方法 B：從本機手動部署

如果您不使用 GitHub Actions，而是選擇直接從本機進行手動部署：

1. **安裝專案依賴**
   ```bash
   npm install
   ```

2. **手動建立 KV 命名空間並配置 `wrangler.toml`**
   在本機終端機執行以下 Wrangler 指令來建立 KV 空間：
   ```bash
   npx wrangler kv namespace create WEBSSH_KV
   ```
   請將此段配置手動複製並替換掉您專案根目錄下 `wrangler.toml` 檔案內原本的預留欄位。

3. **設定登入密碼（選填）**
   推薦直接使用安全命令建立加密密碼，避免將明文密碼寫入代碼：
   ```bash
   npx wrangler secret put ADMIN_PASSWORD
   ```
   *（根據提示輸入您的安全密碼即可，此操作會將密碼直接以加密 Secret 格式上傳至 Cloudflare 端）*

4. **打包編譯與部署**
   執行以下指令，系統會透過 `esbuild` 排除不相容的原生 binary 模組（並套用 `cpu-features` 模擬檔），隨後將程式碼發佈至 Cloudflare：
   ```bash
   npm run deploy
   ```

## 🛡️ Cloudflare Zero Trust (Access) 安全加固詳細教學

若要實現企業級的邊緣安全防護，極力建議您使用 Cloudflare 的 **Zero Trust (Access)** 來保護您的 WebSSH 專案。這能在外部請求觸發 Workers 與 KV 資料庫之前，強制對其進行一線身分驗證。

### 📌 前提條件
1. 您在 Cloudflare 上擁有一個已啟用的自訂網域（例如 `yourdomain.com`）。
2. 已為此 Workers 綁定了自訂網域（在 Workers 控制台 -> `Settings` -> `Domains & Routes` -> `Add` -> 綁定如 `ssh.yourdomain.com`）。

### 🛠️ 步驟 1：開啟 Zero Trust 控制台
1. 登入 [Cloudflare 控制面板](https://dash.cloudflare.com/)。
2. 在左側選單中，點擊 **「Zero Trust」**（若第一次進入，請按指示啟用免費訂閱計劃，支援最多 50 名使用者免費）。

### 🛠️ 步驟 2：建立 Access 應用程式
1. 在 Zero Trust 控制台左側選單，依序點擊 **「Access」** -> **「Applications」**。
2. 點擊右上角的 **「Add an Application」（新增應用程式）**。
3. 選擇 **「Self-hosted」（自我託管）** 類型。

### 🛠️ 步驟 3：配置應用程式路徑
1. **Application Name**：自訂一個名稱（如 `WebSSH Panel`）。
2. **Session Duration**：保持預設，或自訂登入狀態有效期限。
3. **Application Domain**（核心步驟）：
   * **Subdomain**：輸入您的子網域（如 `ssh`）。
   * **Domain**：選取您的自訂網域（如 `yourdomain.com`）。
   * **Path**：保留空白即可（意即保護此子網域下的所有路徑，如 `ssh.yourdomain.com/*`）。
4. 滾動到下方，點擊 **「Next」**。

### 🛠️ 步驟 4：設定存取驗證策略 (Access Policy)
1. **Policy Name**：自訂策略名稱（如 `限本人登入`）。
2. **Action**：選擇 `Allow`。
3. **Configure Rules (Include)**（設定允許的對象）：
   * **Selector**：專區選取 **「Emails」**。
   * **Value**：輸入您個人的 Email 電子郵件（例如 `yourname@gmail.com`）。
4. 點擊 **「Next」**。

### 🛠️ 步驟 5：設定 cookie 與完成
1. 在最後一個「Setup」頁面，保持預設值不變。
2. 點擊右下角的 **「Add Application」** 保存。

---

### 🎉 防護效果測試
現在，不論是您自己或是任何外部使用者，在瀏覽器輸入 `https://ssh.yourdomain.com` 時，都會自動跳轉至 **Cloudflare Access 安全登入頁面**，要求輸入電子郵件：
1. 輸入您的 Email，Cloudflare 將發送一個 **一次性動態密碼 (OTP)** 至您的信箱。
2. 輸入 OTP 通過驗證後，網頁才會順利載入您的 WebSSH 專案。
3. **這是在網際網路最前線（邊緣節點）攔截惡意流量的安全防禦手段！**

## 📝 關於 Cloudflare 網頁編輯器的「紅字錯誤」提示說明

當您打開 Cloudflare Workers 網頁控制台的 **「Quick Edit（快速編輯）」** 線上代碼編輯器時，可能會在 `index.js`（即上傳的打包檔，約 22,000 行）看見數百個紅色或黃色的型別錯誤提示（例如：`Cannot find name 'Buffer'` 或 `Property 'performance' does not exist`）。

* **原因**：控制台網頁編輯器底層使用的是簡化版的 Monaco 靜態檢查器。當它嘗試型別分析這份包含了 `ssh2` 與 Node.js 相容層（Polyfills）的超大型編譯產物時，會因為看不懂 Node.js 原生 API 而報錯。
* **解決與影響**：這**完全不影響代碼的實際運行**，僅僅是線上編輯器前端的顯示干擾。本專案已在編譯腳本 `build.mjs` 中自動將 `// @ts-nocheck` 寫入檔案頂端。如果您在網頁編輯器中仍看見紅字，請**手動重新整理網頁編輯器分頁 (Ctrl + F5)** 以清除瀏覽器的檔案快取，紅字與驚嘆號便會隨之清除。

## 🔒 安全性建議

1. **啟用內建密碼**：強烈建議在生產環境中設定 `ADMIN_PASSWORD` 加密 Secret，這將同時啟用網頁門禁與後端 AES-GCM 零知識加密儲存。
2. **Cloudflare Zero Trust / Cloudflare Access (雙重保障)**：
   對於極高安全要求的用戶，除了設定 `ADMIN_PASSWORD`，還可以依據上方的 **Zero Trust 教學** 為專案網域設定一條 Access 存取策略，限定僅允許您信任的電子郵件才能存取本 WebSSH 頁面。
