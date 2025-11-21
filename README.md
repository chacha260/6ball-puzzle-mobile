# とりあえず備忘録で
```bash
npm create vite@latest sixball -- --template react-ts
cd sixball
npm install
```
```bash
# Tailwind CSS と関連ツールのインストール
npm install -D tailwindcss postcss autoprefixer
# 設定ファイルの生成 (tailwind.config.js と postcss.config.js が作られます)
npx tailwindcss init -p
```
ファイル: `tailwind.config.js`
```js
/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}", // ここを修正
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}
```
ファイル: `src/index.css`
```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```
```bash
npm install lucide-react
```
ファイル:`src/App.tsx`を`6ball.tsx`の内容で置き換え
```bash
npm run dev
```
でブラウザで開ける、、、はず
