# 91APP 世界盃開踢 — 冠軍預測活動網頁

員工填表單預測 2026 世界盃冠軍，網頁即時呈現預測人氣、賽程戰況與各隊球星；賽事期間賽果每日自動更新。資料以 Google Sheet 為單一來源，透過 Apps Script Web App 提供給網頁。

---

## 一、功能特色

- **官方賽程圖**：依 FIFA 官方結構，自 32 強起的單淘汰對戰圖，**冠軍置中、兩側往中間收斂**；小組賽結束前以「組別代號」（A 組亞軍、E 組冠軍、某組最佳第三…）占位，確定後換成真實隊伍。
- **晉級／淘汰動畫**：賽果填入後自動播放「晉級 ✔／淘汰 OUT」與冠軍彩帶效果。
- **每場資訊**：每場顯示日期、時間（UTC+8）、場地、比分（含 PK 點球大戰標記）。
- **冠軍預測人氣榜**：統計員工實際預測，依人數排序；點隊伍可看預測者名單（綽號＋部門，不含 email）。
- **各隊關鍵球星**：彈窗介紹各隊代表球星，球員照片即時取自維基百科（自由授權）。
- **活動辦法／獎品**：含「運動基金」動態計算（參與人數 × 100 元；命中冠軍者平分，四捨五入至百位）。
- **立即預測 CTA**：連到 Google 表單，連結可由 Sheet 即時更換。
- **手機版優化**：RWD 自適應。
- **視覺**：2026 官方主視覺配色（金色＋黑白，主辦三色 加拿大紅／美國藍／墨西哥綠 為點綴）。

---

## 二、檔案結構

| 檔案 | 說明 |
|---|---|
| `index.html` | 活動網頁本體（單檔，含 HTML／CSS／JS）。直接用瀏覽器開啟即可。 |
| `Code.gs` | Google Apps Script（Web App）。貼到 Sheet 的 Apps Script 專案。 |
| `資料來源規劃_GoogleSheet_AppsScript.md` | 資料架構規劃：分頁欄位、API、mapping 對照表、設定步驟。 |
| `README.md` | 本文件。 |

> 另有一個排程任務 `worldcup2026-daily-results`（位於 `Documents/Claude/Scheduled/`），每日抓賽果。

---

## 三、系統架構

```
員工 ── Google 表單 ──▶ Google Sheet（predictions / teams / results / meta）
                                  │
                       Apps Script Web App
                       ├─ doGet：回傳 JSON ───────▶ index.html（fetch 顯示）
                       ├─ doPost：外部 caller 寫入（Zapier／後端，帶 token）
                       └─ importFromDrive：讀 Drive 檔 → 寫回 Sheet（時間觸發器）
                                  ▲
每日 07:00 Claude 排程：抓運動新聞賽果 → 整理 JSON → 寫成 Drive 檔 worldcup_results.json
```

資料單一來源＝Google Sheet；網頁只讀、不寫。賽果寫回有三條路：①外部 POST、②Claude→Drive→匯入、③手動編輯分頁。

---

## 四、Google Sheet 結構（4 個分頁）

**`predictions`**（員工預測）：`email`｜`department`｜`nickname`｜`champion`
- 表單顯示中文隊名，`champion` 存中文隊名或代碼；系統用 `teams` 的 `code↔name` 自動對照。
- `email` 僅留存對獎用，**不輸出到網頁**。

**`teams`**（32 強名單＋對戰位置）：`code`｜`name`｜`flag`｜`predictable`｜`match`(0–15)｜`pos`(0/1)
- `match`/`pos` 決定該隊落在賽程圖哪個 32 強格子（占位 → 真實隊伍）。

**`results`**（賽果）：`matchId`(r0m0…r4m0)｜`winner`(代碼)｜`score`("上-下")｜`pk`("上-下"，無則空)

**`meta`**（設定）：`key`｜`value`
- `last_updated`、`demo_mode`(TRUE/FALSE)、`form_url`(立即預測連結，可隨時改)

---

## 五、網頁設定（index.html 最上方 `CONFIG`）

| 欄位 | 說明 |
|---|---|
| `API_URL` | Apps Script Web App 的 `/exec` 網址（核心：填了才會讀 Sheet）。 |
| `FORM_URL` | 預測表單預設連結（可被 `meta.form_url` 覆寫）。 |
| `DEMO_MODE` | `false`＝正式（依 Sheet）；`true`＝展示模式（用內建 16 國範例，純預覽動畫）。 |
| `ACTIVITY` | 活動期間、參加方式、運動基金每人金額等文案。 |

> 人氣榜與球星皆**資料驅動**：人氣榜統計 `predictions` 實際資料、球星顯示內建有資料的隊伍，**不需維護任何名單**。

---

## 六、資料運作邏輯

- **正式模式（demo_mode=FALSE）**：隊伍／預測／賽果／設定全部來自 Google Sheet。沒有任何預測時人氣榜顯示「目前還沒有人預測冠軍」。
- **展示模式（demo_mode=TRUE）**：使用內建 16 國與範例賽果，供上線前預覽動畫與版面。
- **賽程圖占位 → 真實隊伍**：賽程結構固定為 FIFA 官方 32 強骨架；`teams` 分頁一旦依 `match`/`pos` 填入真實隊伍（依「組別名次 → match/pos 對照表」），對應格子即換成真實隊，賽果也開始視覺化。

---

## 七、每日自動更新（排程 + Drive 交接）

Claude 排程（每日約 07:00）抓主流運動新聞賽果，整理成 JSON 寫到指定 Drive 資料夾的 `worldcup_results.json`；Apps Script 的 `importFromDrive()`（建議設每日 07:10 時間觸發器）讀檔寫回 Sheet 後刪檔。

- 32 強對戰公布後（約 6/28），排程會一次把真實 32 隊（含 `match`/`pos`）寫入 `teams`。
- Claude 只能 GET、無法主動 POST，故採「寫 Drive 檔」交接；若 Drive 連接器不可用，排程會改更新網頁或在回報列出 JSON。

---

## 八、上線檢查清單

1. 建好 Sheet 四個分頁與表頭（`predictions`／`teams`／`results`／`meta`）。
2. `Code.gs` 貼上 → 設 `WRITE_TOKEN` 與 `DRIVE_FOLDER_ID` → 部署為 Web App（執行身分＝我、存取＝任何人）。
3. 將 `/exec` 網址填入 `index.html` 的 `CONFIG.API_URL`。
4. `meta` 設 `demo_mode=FALSE`、填 `form_url`。
5. Apps Script 設 `importFromDrive` 每日 07:10 時間觸發器。
6. 確認 Claude 的 Google Drive 連接器與 Sheet 同一 Google 帳號；對排程按一次「Run now」預先授權。
7. 將 `index.html` 部署到可公開存取的位置（或內部空間）供員工開啟。

---

## 九、限制與注意事項

- 球員照片、球星簡介為內建於網頁的資料（目前涵蓋 16 國代表隊）；新隊伍需另行補充。
- 賽程的對戰組合在小組賽結束前為官方「組別代號」占位，非真實隊名／國旗。
- 自動寫回 Sheet 需「可寫入試算表的途徑」（Drive 交接觸發器、或外部 POST）；單靠 Claude 排程無法直接 POST。
- 網頁為公開頁面，JSON 內容（不含 email）任何人可見；勿放敏感資料。
- 照片與 QR、API 讀取需連網。

---

## 十、版本／維護備註

- 賽制依 FIFA 官方：2026 世界盃 48 隊，淘汰賽自 32 強開始（32→16→8→4→決賽）。
- 賽程時間為 UTC+8，依 FIFA 官方各場開球時間換算。
- 詳細資料架構與 mapping 對照表見 `資料來源規劃_GoogleSheet_AppsScript.md`。

---

## 十一、常見問題與疑難排解

**Q1. 頁面底部顯示「內建範例」而不是「Google Sheet 即時匯入 ✅」？**
代表沒讀到 Sheet。逐項檢查：
1. `CONFIG.API_URL` 是否填了正確的 `/exec` 網址。
2. Web App 部署的「誰可存取」要設 **任何人**；改過程式要 **重新部署（版本選新版本）**。
3. 直接用瀏覽器開 `/exec`，應看到 `{"meta":...,"teams":...}` JSON；開 `/exec?callback=test` 應看到 `test({...})`。
4. 分頁名稱與表頭需與規劃一致。
5. `meta.demo_mode` 設為 `FALSE`（`TRUE` 會走內建範例）。

**Q2. 人氣榜顯示「目前還沒有人預測冠軍」？**
- `predictions` 分頁尚無資料；或
- `champion` 欄的中文隊名與 `teams.name` 對不上（錯字、簡繁、空白）。請確認表單選項文字與 `teams.name` 完全一致。

**Q3. Claude 寫了 Drive 檔，但 Sheet 沒更新？**
1. Apps Script 是否已設 `importFromDrive` 的 **時間觸發器**（每日 07:10）。
2. Drive 檔是否在指定資料夾、檔名正好是 `worldcup_results.json`。
3. Apps Script 與 Drive 檔是否 **同一個 Google 帳號**。
4. 是否已部署含 `importFromDrive`／`applyWrite_` 的最新 `Code.gs`。
5. 在編輯器手動執行 `importFromDrive` 看執行紀錄是否報錯。

**Q4. 賽程圖一直是「組別代號」（A 組亞軍…）？**
這是小組賽結束前的正常狀態。`teams` 分頁依「組別名次 → match/pos 對照表」填入真實隊伍後才會替換（排程會在 R32 公布後自動寫入）。

**Q5. 賽果填了，賽程圖卻沒晉級／沒動畫？**
- `results.winner` 的代碼要與該場兩隊之一相符；占位狀態（還沒填真實隊）下賽果不會視覺化。
- `matchId` 格式需正確（`r0m0`…`r4m0`）。
- `demo_mode=TRUE` 會以範例覆蓋，請確認為 `FALSE`。

**Q6.「立即預測」連到舊網址／沒反應？**
改 `meta.form_url` 即可即時更換；`CONFIG.FORM_URL` 為預設後備。若按了沒反應，代表兩者皆空。

**Q7. 球員照片沒出現，只有字母圓圈？**
照片在「⭐ 各隊關鍵球星」彈窗內即時抓維基百科，需 **連網** 且以 **一般瀏覽器** 開啟；該球員若無自由授權照片則保留字母頭像（屬正常）。

**Q8. 比分數字對應錯邊？**
`score` 格式為「上方隊-下方隊」（slot0-slot1）；PK 用 `4-2` 填在 `pk` 欄。

**Q9. 呼叫 `doPost` 回傳 `unauthorized`？**
body 的 `token` 與 `Code.gs` 的 `WRITE_TOKEN` 不一致。

**Q10. 瀏覽器主控台出現 CORS 錯誤？**
確認 Web App 存取權為「任何人」；網頁已內建 JSONP 後備（`?callback=`），需 `doGet` 支援 callback（最新 `Code.gs` 已含）。
