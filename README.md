# Jira Gantt MD

Jira Gantt MD 是一個零依賴的本機網頁管理服務，結合 Jira 式 issue/sub-issue 管理、Gantt 時間區間檢視、Mindmap 主從關係檢視，以及每個工作項目一個 Markdown 檔案的儲存方式。

目前這是一個可試用的雛形，後端只使用 Python 標準庫，前端是純 HTML/CSS/JavaScript。

## 功能

- Jira 畫面：新增、編輯、刪除 issue。
- Sub-issue：用「上層項目」欄位管理主從關係。
- 欄位：標題、描述、建立時間、開始日期、最後期限、狀態。
- Gantt 畫面：依照開始日期與 deadline 顯示工作項目的時間區間。
- Mindmap 畫面：用節點圖呈現 issue/sub-issue 主從關係。
- Mindmap 拖拉：拖曳節點到另一個節點附近，可改變父子關係。
- Markdown 儲存：每個工作項目都存成 `issues/*.md`。

## 執行

需要 Python 3。

```bash
python3 app.py
```

打開瀏覽器：

```text
http://127.0.0.1:8000
```

## 使用方式

1. 到 `Jira` 分頁新增或編輯工作項目。
2. 設定 `開始日期` 和 `最後期限` 後，可以到 `Gantt` 分頁查看時間區間。
3. 到 `Mindmap` 分頁查看主從關係。
4. 在 `Mindmap` 拖曳節點到另一個節點附近，可以把它改成對方的子項目。
5. 在 `Mindmap` 點一下節點但不拖曳，會跳回 `Jira` 分頁並打開該項目。

## 儲存格式

工作項目會存到 `issues/`，每個檔案是一個 Markdown：

```markdown
---
id: 12345678
parent_id:
title: 範例項目
created_at: 2026-06-13T11:00:00Z
start_date: 2026-06-13
deadline: 2026-06-20
status: todo
---

這裡是描述內容。
```

`parent_id` 空白代表最上層項目；若填入其他 issue 的 `id`，就代表它是該 issue 的子項目。

## 專案結構

```text
.
├── app.py
├── README.md
├── issues/
│   └── *.md
└── static/
    ├── app.js
    ├── index.html
    └── styles.css
```

## 上傳到 GitHub

### 方式一：用 GitHub 網頁建立 repo，再用命令列上傳

1. 在 GitHub 右上角按 `+`，選 `New repository`。
2. Repository name 可以填：

```text
jira-gantt-md
```

3. 建議先不要勾選 `Add a README file`，因為本專案已經有 README。
4. 建立 repository 後，GitHub 會顯示一段 `push an existing repository` 指令。
5. 在本機專案資料夾執行：

```bash
git init
git add .
git commit -m "Initial Jira Gantt MD prototype"
git branch -M main
git remote add origin https://github.com/YOUR_ACCOUNT/jira-gantt-md.git
git push -u origin main
```

請把 `YOUR_ACCOUNT` 換成你的 GitHub 帳號，例如：

```bash
git remote add origin https://github.com/shcchen/jira-gantt-md.git
```

### 方式二：用 GitHub Desktop

1. 安裝並打開 GitHub Desktop。
2. 選 `File` -> `Add local repository`。
3. 選擇這個專案資料夾。
4. 如果它還不是 git repository，GitHub Desktop 會引導你建立。
5. 填寫 commit message。
6. 按 `Publish repository` 上傳到 GitHub。

## 備註

- 這個版本適合本機單人使用。
- 目前沒有登入、多人同步、權限控管。
- `issues/` 裡的 Markdown 檔案就是你的資料，可以一起 commit 到 GitHub，也可以改成私有 repo 保存。
