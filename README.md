# cf-webssh

一個基於 Cloudflare Workers (`workerd`) 平台構建的輕量級 WebSSH 工具。

本專案利用 Cloudflare 原生 TCP 接口（透過相容性標誌 `nodejs_compat` 啟用 `cloudflare:sockets`）與遠端主機建立安全的 SSH 通道，並在瀏覽器前端使用 `xterm.js` 提供高度互動性的終端體驗。

## 🎯 專案特點

- **無伺服器架構**：完全依賴 Cloudflare Workers 邊緣網路，無需部署與維護傳統的 WebSSH 後端伺服器（如 Bastion、Guacamole 等）。
- **可選的管理密碼保護（新增）**：
  - 支援設置環境變數 `ADMIN_PASSWORD` 作為管理員登入密碼。
  - **向下相容**：若未配置該變數，系統會自動切換為免密碼模式（不顯示登入頁面），行為與原版本一致。
  - **安全 Session 保護**：採用具有 `HttpOnly`、`Secure`、`SameSite=Strict` 屬性的安全 Cookie，能同時且安全地為 API 接口與 WebSocket 握手進行無狀態認證保護。
  - **完整登出機制**：前端支援一鍵登出清除 Session。
- **多伺服器配置管理**：支援記錄與維護多台伺服器的連線。所有主機資訊（不含密碼/私鑰）與敏感認證憑據（密碼、SSH 私鑰）皆安全地儲存於您個人的 Cloudflare KV 命名空間中。
- **安全編輯與局部更新**：提供完整的「新增、刪除、編輯」功能。前端卡片支援一鍵編輯，且後端 `POST` API 具備局部合併機制，若您在編輯伺服器時未重新填寫密碼或私鑰，系統會自動保留原先在 KV 中的敏感認證資訊，避免遺失。
- **優化的 xterm.js 終端**：
  - **自動聚焦 (Auto Focus)**：連線載入完成後自動鎖定焦點，無需手動用滑鼠點擊即可直接開始打字輸入。
  - **視窗尺寸動態同步**：支援瀏覽器視窗縮放時，自動向遠端虛擬終端（Pseudo-terminal, PTY）發送 `resize` 訊號。
  - **初次連線尺寸修正**：引入 `pendingResize` 機制，確保在 SSH 串流未就緒前發送的視窗初始化大小，能在連線建立的第一時間被套用。
- **Cloudflare Workers 專屬相容性適配**：
  - 針對 Workers 執行環境底層 BoringSSL 在計算 **X25519 DH 共享金鑰** 時的限制，主動排除 `curve25519` 相關的金鑰交換演算法（KEX），改用 NIST 標準曲線（如 `ecdh-sha2-nistp256`）或有限域 Diffie-Hellman 演算法進行握手。
  - 針對 Workers 的 `node:crypto` 串流解密不完整支援 AEAD 模式（如 `chacha20-poly1305`、`aes-gcm`）而會拋出 `No auth tag provided` 的限制，主動在握手階段限制僅協商使用 **CTR 計數器模式** 與 **CBC 模式**（如 `aes256-ctr`），配合獨立的 HMAC 校驗（如 `hmac-sha2-256`），確保資料傳輸穩定不中斷。

## ⚙️ 系統需求

- [Cloudflare 帳戶](https://dash.cloudflare.com/)
- [Node.js](https://nodejs.org/) (建議使用 v18.0.0 以上之版本)

## 🚀 部署指南

### 方法 A：透過 GitHub Actions 自動部署（推薦）

本專案已內建完整的 CI/CD 自動化工作流。當您將專案推送到 GitHub 的 `main` 分支時，系統將會**全自動處理 KV 命名空間**：

1. 將本專案上傳至您的 GitHub 私人儲存庫（Repository）。
2. 在 GitHub 專案的 `Settings -> Secrets and variables -> Actions` 中，新增一個名為 `CLOUDFLARE_API_TOKEN` 的 Secret（此 Token 需具備編輯 Workers 與 KV 命名空間的權限）。
3. 將代碼推送至 `main` 分支。
4. GitHub Actions 工作流（`.github/workflows/deploy.yml`）會自動偵測您的 Cloudflare 帳戶中是否已存在 `WEBSSH_KV` 命名空間。若不存在，將自動為您建立，並**自動動態填入** `wrangler.toml` 中的 `KV_NAMESPACE_ID_PLACEHOLDER`，最後完成編譯與部署。您無需進行任何手動文件修改。

> 💡 **如何在使用 GitHub Actions 部署時設置登入密碼？**
> 請直接登入 [Cloudflare Dashboard](https://dash.cloudflare.com/)，進入您的 Workers 項目，點選 `Settings` -> `Variables` -> `Environment Variables`，手動新增變數 `ADMIN_PASSWORD`。為了安全性，請將其儲存類型設為 **Encrypt (Secret)**。

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
   指令執行後會輸出一段類似下方的配置：
   ```toml
   [[kv_namespaces]]
   binding = "WEBSSH_KV"
   id = "xxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
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

## 🔒 安全性建議

1. **啟用內建密碼**：強烈建議在生產環境中設定 `ADMIN_PASSWORD` 加密 Secret。
2. **Cloudflare Zero Trust / Cloudflare Access (雙重保障)**：
   對於極高安全要求的用戶，除了設定 `ADMIN_PASSWORD`，還可以在 Cloudflare Zero Trust 控制面板中為您部署此 Worker 的域名設定一條 Access 存取策略，限定僅允許您信任的電子郵件（如使用 Google/GitHub 登入認證）或特定 IP 網段才能存取本 WebSSH 頁面。
