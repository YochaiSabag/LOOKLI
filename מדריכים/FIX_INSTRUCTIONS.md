# 🔧 תיקון מהיר - .env לא נקרא

## הבעיה
הקבצים `init-db.js` ו-`index.js` לא קוראים את קובץ `.env` אוטומטית.

## ✅ הפתרון (3 צעדים)

### שלב 1: החלף 3 קבצים

הורד את הקבצים המצורפים:
- `init-db.js` (מתוקן - טוען .env)
- `index.js` (מתוקן - טוען .env)
- `package.json` (עם dotenv)

והחלף אותם בתיקיית הפרויקט שלך.

### שלב 2: התקן dotenv

```powershell
npm install
```

זה יתקין את החבילה `dotenv` שחסרה.

### שלב 3: נסה שוב

```powershell
npm run init-db
```

---

## 🎯 צעדים מלאים (ב-PowerShell)

```powershell
# 1. עצור את השרת אם רץ (Ctrl+C)

# 2. החלף את הקבצים (הורד מהלינקים למעלה)
# שים את init-db.js החדש והpackage.json החדש בתיקייה

# 3. התקן תלויות
npm install

# 4. נסה שוב
npm run init-db

# צריך לראות:
# 🔌 Connecting to DB...
# 🧱 Running schema.sql...
# ✅ DB initialized successfully
```

---

## 💡 מה השתנה?

### init-db.js החדש:
```javascript
import dotenv from "dotenv";

// Load environment variables from .env file
dotenv.config();
```

### package.json החדש:
```json
"dependencies": {
  "dotenv": "^16.4.5",  ← זה נוסף!
  "express": "^4.18.2",
  "pg": "^8.16.3"
}
```

---

## 🐛 אם עדיין לא עובד

### בדוק ש-.env קיים ויש בו תוכן:

```powershell
Get-Content .env
```

צריך לראות:
```
DATABASE_URL=postgresql://postgres:password@localhost:5432/lookli
PORT=3000
NODE_ENV=development
```

### בדוק ש-Docker רץ:

```powershell
docker ps
```

צריך לראות `lookli_db` ברשימה.

---

## ✅ אחרי שעובד

```powershell
# הרץ את השרת
npm start

# צריך לראות:
# ✅ DB connected (NO SSL)
# 🚀 Server running on port 3000
```

**בהצלחה!** 🚀
