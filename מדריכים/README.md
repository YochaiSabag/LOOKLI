# חיפושIT - מנוע חיפוש אופנה חכם 🛍️

מנוע חיפוש חכם לאופנה עם AI שמאפשר חיפוש טבעי בעברית ופילטור מתקדם.

## 🏗️ מבנה הפרויקט

```
lookli-fashion/
├── index.js                    # שרת Express + API
├── index.html                  # ממשק משתמש (RTL)
├── scraper.js                  # סקרייפר Mekimi (מתוקן)
├── init-db.js                  # אתחול DB
├── schema.sql                  # סכמת DB
├── package.json                # תלויות
├── docker-compose.yml          # Docker ללוקאל
├── .env.example                # דוגמה למשתני סביבה
└── .gitignore                  # קבצים להתעלמות
```

---

## 🚀 התחלה מהירה

### דרישות מקדימות
- Node.js 18+ 
- Docker Desktop (ללוקאל)
- Railway CLI (לפריסה)

---

## 💻 פיתוח לוקאלי

### 1️⃣ התקנה ראשונית

```bash
# שכפול הפרויקט
git clone <your-repo>
cd lookli-fashion

# התקנת תלויות
npm install

# יצירת .env מהדוגמה
cp .env.example .env
```

### 2️⃣ הרצת PostgreSQL מקומי (Docker)

```bash
# הרצת Docker Compose
docker-compose up -d

# בדיקת סטטוס
docker-compose ps

# צפייה בלוגים
docker-compose logs -f db
```

זה יקים:
- **PostgreSQL** על `localhost:5432`
- **pgAdmin** על `http://localhost:5050` (אופציונלי)

### 3️⃣ עריכת .env

ערוך את הקובץ `.env`:

```env
DATABASE_URL=postgresql://postgres:password@localhost:5432/lookli
PORT=3000
NODE_ENV=development
```

### 4️⃣ אתחול DB

```bash
# הרצת schema
npm run init-db
```

זה יוצר את טבלת `products` עם כל האינדקסים.

### 5️⃣ הרצת השרת

```bash
# מצב development
npm start
```

גש ל-http://localhost:3000

### 6️⃣ הרצת הסקרייפר (אופציונלי)

```bash
# הרצת סקרייפר Mekimi
node scraper.js
```

הסקרייפר:
- ✅ רץ עם דפדפן נראה (headless: false) בלוקאל
- ✅ מנרמל צבעים ומידות
- ✅ שומר ל-DB
- ⚠️ דורש Playwright browsers

התקנת Playwright browsers (פעם אחת):
```bash
npx playwright install chromium
```

---

## ☁️ פריסה לענן (Railway)

### 1️⃣ הכנת הפרויקט

```bash
# ודא שיש .gitignore
# ודא שאין .env בגיט

git add .
git commit -m "Ready for production"
git push
```

### 2️⃣ יצירת פרויקט ב-Railway

1. גש ל-https://railway.app
2. התחבר עם GitHub
3. לחץ **New Project** → **Deploy from GitHub**
4. בחר את הריפו שלך

### 3️⃣ הוספת PostgreSQL

1. בפרויקט Railway, לחץ **+ New**
2. בחר **Database** → **PostgreSQL**
3. Railway יוצר אוטומטית את `DATABASE_URL`

### 4️⃣ הגדרת משתני סביבה

בטאב **Variables** של השרת שלך, הוסף:

```
NODE_ENV=production
PORT=3000
```

(ה-`DATABASE_URL` כבר קיים אוטומטית מה-Postgres)

### 5️⃣ אתחול DB בענן

**אופציה A: דרך Railway CLI**
```bash
railway login
railway link
railway run npm run init-db
```

**אופציה B: דרך הממשק**
1. בטאב **Settings** → **Start Command**
2. הפעל זמנית: `node init-db.js`
3. אחרי שרץ, החזר ל-`node index.js`

### 6️⃣ בדיקת הפריסה

```bash
# צפייה בלוגים
railway logs

# בדיקת Health
curl https://your-app.railway.app/health

# בדיקת Debug
curl https://your-app.railway.app/api/debug
```

---

## 🔄 Workflow: לוקאל ← → ענן

### תרחיש 1: עבודה רגילה

```bash
# 1. שינויים לוקאל
# ערוך קבצים...

# 2. בדיקה לוקאלית
npm start

# 3. העלאה לענן
git add .
git commit -m "Feature X"
git push

# Railway יפרוס אוטומטית! 🎉
```

### תרחיש 2: טעינת נתונים (Scraping)

**⚠️ חשוב: אל תריץ סקרייפר בענן!**

הסקרייפר צריך לרוץ **רק בלוקאל**:

```bash
# 1. לוקאל: הרץ סקרייפר
node scraper.js

# 2. הנתונים נשמרו ב-DB המקומי

# 3. העבר נתונים לענן (אופציה A: pg_dump)
pg_dump -h localhost -U postgres -d lookli > backup.sql
psql $DATABASE_URL < backup.sql

# 3. או (אופציה B: הרץ סקרייפר מול Railway DB)
# שנה את .env זמנית ל-Railway DATABASE_URL
node scraper.js
# החזר את .env ללוקאל
```

### תרחיש 3: סנכרון DB

**מענן ללוקאל:**
```bash
# קבל DATABASE_URL מ-Railway
railway variables

# גבה מהענן
pg_dump $RAILWAY_DATABASE_URL > cloud_backup.sql

# טען ללוקאל
psql postgresql://postgres:password@localhost:5432/lookli < cloud_backup.sql
```

**מלוקאל לענן:**
```bash
# גבה מלוקאל
pg_dump postgresql://postgres:password@localhost:5432/lookli > local_backup.sql

# טען לענן
psql $RAILWAY_DATABASE_URL < local_backup.sql
```

---

## 📊 API Endpoints

### Health Check
```
GET /health
```

### Debug Info
```
GET /api/debug
```

### Products
```
GET /api/products?q=שמלה&color=שחור&size=M&maxPrice=300
```

### AI Search
```
POST /api/ai-search
Body: { "query": "שמלה שחורה מידה M עד 200 שקל" }
```

### Filters
```
GET /api/filters?store=MEKIMI&category=שמלה
```

---

## 🛠️ פקודות שימושיות

```bash
# פיתוח
npm start                   # הרצת שרת
npm run init-db             # אתחול DB
node scraper.js             # הרצת סקרייפר

# Docker
docker-compose up -d        # הרצת DB
docker-compose down         # כיבוי DB
docker-compose logs -f      # צפייה בלוגים

# Railway
railway login               # התחברות
railway link                # חיבור לפרויקט
railway logs                # לוגים מענן
railway run <command>       # הרצת פקודה בענן
railway variables           # צפייה במשתנים
```

---

## 🐛 פתרון בעיות

### DB לא מתחבר בלוקאל
```bash
# בדוק שDocker רץ
docker ps

# בדוק לוגים
docker-compose logs db

# רסטארט
docker-compose restart db
```

### DB לא מתחבר בענן
```bash
# בדוק שיש DATABASE_URL
railway variables

# בדוק שהDB רץ
railway logs --service postgres
```

### Playwright לא רץ
```bash
# התקן browsers
npx playwright install chromium

# בענן - אל תריץ! הסקרייפר דורש GUI
```

### Port already in use
```bash
# מצא מי משתמש בפורט
lsof -i :3000

# הרוג תהליך
kill -9 <PID>
```

---

## 📝 הערות חשובות

1. **אבטחה**: אל תעלה `.env` לגיט!
2. **סקרייפר**: הרץ רק בלוקאל, לא בענן
3. **גיבויים**: גבה את ה-DB לפני שינויים גדולים
4. **Railway**: משתמש ב-hobby plan עם 5GB storage
5. **SSL**: Railway מטפל ב-SSL אוטומטית

---

## 🎯 מה הלאה?

- [ ] הוסף חנויות נוספות (Lichi, Zara...)
- [ ] שפר את ה-AI search
- [ ] הוסף authentication
- [ ] הוסף wishlist
- [ ] שלב עם Stripe לתשלומים

---

## 📧 תמיכה

יש בעיה? פתח issue ב-GitHub!

**Made with ❤️ by your team**
