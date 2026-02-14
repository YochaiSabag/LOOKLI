# 🚀 Quick Start - חיפושIT

## התחלה מהירה בלוקאל (5 דקות)

### 1. הכנה
```bash
git clone <your-repo>
cd lookli-fashion
npm install
cp .env.example .env
```

### 2. הרצת DB
```bash
# הפעל Docker Desktop תחילה!
npm run db:start

# המתן 10 שניות
npm run init-db
```

### 3. הרצת השרת
```bash
npm start
```

✅ גש ל-http://localhost:3000

---

## הרצת סקרייפר (אופציונלי)

```bash
# התקנת Playwright (פעם אחת)
npx playwright install chromium

# הרצת הסקרייפר
npm run scrape
```

---

## פריסה לRailway (10 דקות)

### 1. צור פרויקט חדש
- גש ל-https://railway.app
- **New Project** → **Deploy from GitHub**
- בחר את הריפו

### 2. הוסף PostgreSQL
- **+ New** → **Database** → **PostgreSQL**

### 3. עדכן Start Command
- **Settings** → **Deploy** → **Start Command**
- שנה ל-: `npm run init-db && npm start`
- (רק בפריסה הראשונה!)

### 4. אחרי פריסה ראשונה
- **Settings** → **Deploy** → **Start Command**
- החזר ל-: `npm start`

✅ זהו! האתר שלך באוויר!

---

## בעיות נפוצות

### Docker לא עובד
```bash
# ודא שDocker Desktop רץ
docker ps

# רסטארט
npm run db:stop
npm run db:start
```

### Port תפוס
```bash
# מצא מי תופס את הפורט
lsof -i :3000

# הרוג
kill -9 <PID>
```

### DB לא מתחבר
```bash
# בדוק .env
cat .env

# צריך להיות:
# DATABASE_URL=postgresql://postgres:password@localhost:5432/lookli
```

---

## פקודות שימושיות

```bash
npm start          # הרצת שרת
npm run dev        # מצב development
npm run scrape     # הרצת סקרייפר
npm run init-db    # אתחול DB

npm run db:start   # הפעלת Docker DB
npm run db:stop    # כיבוי Docker DB
npm run db:logs    # צפייה בלוגים
```

---

## מבנה נתונים

```sql
-- טבלת products
id              SERIAL PRIMARY KEY
store           VARCHAR(50)        -- MEKIMI, LICHI
title           TEXT               -- כותרת המוצר
price           DECIMAL(10,2)      -- מחיר נוכחי
original_price  DECIMAL(10,2)      -- מחיר מקורי (למבצעים)
image_url       TEXT               -- תמונה ראשית
images          TEXT[]             -- מערך תמונות
sizes           TEXT[]             -- מערך מידות [S, M, L]
color           VARCHAR(50)        -- צבע ראשי
colors          TEXT[]             -- מערך צבעים
style           VARCHAR(50)        -- סגנון
fit             VARCHAR(50)        -- גיזרה
category        VARCHAR(50)        -- קטגוריה
description     TEXT               -- תיאור
source_url      TEXT UNIQUE        -- קישור למוצר
color_sizes     JSONB              -- מיפוי צבע→מידות
last_seen       TIMESTAMP          -- עדכון אחרון
```

---

## API דוגמאות

### חיפוש פשוט
```bash
curl "http://localhost:3000/api/products?q=שמלה"
```

### חיפוש מתקדם
```bash
curl "http://localhost:3000/api/products?category=שמלה&color=שחור&size=M&maxPrice=300"
```

### חיפוש AI
```bash
curl -X POST http://localhost:3000/api/ai-search \
  -H "Content-Type: application/json" \
  -d '{"query":"שמלה שחורה מידה M עד 200 שקל"}'
```

### פילטרים זמינים
```bash
curl "http://localhost:3000/api/filters?store=MEKIMI"
```

---

**צריך עזרה? קרא את README.md המלא!**
