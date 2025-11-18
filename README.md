# LINE Courses

LINE 風格的高雄建築師公會專業課程快覽。專案會抓取 [news_class_list.php](https://www.kaa.org.tw/news_class_list.php) 上公開的課程資訊，重新整理為方便搜尋、篩選與行動瀏覽的版面。

## 功能簡述

- 每日抓取課程列表與報名連結，輸出成 `public/data/courses.json`。
- 依照開課日期自動分類「尚未開課 / 即將開課 / 已結束」。
- 支援關鍵字搜尋、開課狀態切換與排序。
- 純前端版面，可直接部署在 GitHub Pages。

## 使用方式

1. 安裝依賴

   ```bash
   npm install
   ```

2. 擷取課程資料（會覆寫 `public/data/courses.json`）

   ```bash
   npm run fetch
   ```

3. 啟動本機預覽

   ```bash
   npm run start
   ```

   預設使用 `npx serve` 啟動簡單的靜態伺服器。

## 佈署到 GitHub Pages

1. 在 GitHub 建立名為 `line-courses` 的倉庫。
2. 將此資料夾初始化為 git repo，推送到 `origin/main`。
3. 在 GitHub 介面啟用 Pages（Branch: `main`, Folder: `/root`），即可得到公開網址。
4. 未來若要更新資料，重新執行 `npm run fetch` 並推送新的 `courses.json`。

## 檔案結構

- `scripts/fetchCourses.js`：從 KAA 網站抓取課程並輸出 JSON。
- `public/`：靜態網站（`index.html`, `app.js`, `styles.css`, `data/courses.json`）。
- `package.json`：包含腳本與依賴設定。

## 注意事項

- 抓取腳本會逐頁請求並適度延遲，避免對官方伺服器造成壓力。
- 若官方網站停機或改版，請檢查 `fetchCourses.js` 做相應調整。
