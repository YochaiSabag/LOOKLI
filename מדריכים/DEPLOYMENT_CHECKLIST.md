# ✅ Deployment Checklist

## 📋 לפני שמתחיל

### הכנת הפרויקט
- [ ] הורדתי את כל הקבצים החדשים
- [ ] קראתי את CHANGES.md
- [ ] יש לי Docker Desktop מותקן (ללוקאל)
- [ ] יש לי Node.js 18+ מותקן
- [ ] יש לי חשבון Railway (לענן)

---

## 💻 Setup לוקאלי

### שלב 1: התקנה בסיסית
- [ ] `cp .env.example .env`
- [ ] ערכתי את .env עם DATABASE_URL מקומי
- [ ] `npm install`
- [ ] הרצתי `npm run db:start`
- [ ] המתנתי 10 שניות

### שלב 2: אתחול DB
- [ ] `npm run init-db`
- [ ] בדקתי שטבלת products נוצרה:
  ```bash
  psql postgresql://postgres:password@localhost:5432/lookli -c "\dt"
  ```
- [ ] בדקתי ש-COUNT=0:
  ```bash
  psql postgresql://postgres:password@localhost:5432/lookli -c "SELECT COUNT(*) FROM products"
  ```

### שלב 3: הרצת השרת
- [ ] `npm start`
- [ ] פתחתי http://localhost:3000
- [ ] בדקתי /health - מחזיר `{"status":"ok"}`
- [ ] בדקתי /api/debug - מחזיר DB info

### שלב 4: סקרייפר (אופציונלי)
- [ ] `npx playwright install chromium`
- [ ] `npm run scrape`
- [ ] בדקתי שנתונים נשמרו:
  ```bash
  psql postgresql://postgres:password@localhost:5432/lookli -c "SELECT COUNT(*) FROM products"
  ```

---

## ☁️ פריסה לRailway

### שלב 1: הכנת Git
- [ ] `.env` לא בגיט (בדיקה: `git status`)
- [ ] `.gitignore` קיים
- [ ] כל הקבצים החדשים בגיט:
  - [ ] schema.sql
  - [ ] docker-compose.yml
  - [ ] .env.example
  - [ ] .gitignore
  - [ ] כל ה-*.md files

### שלב 2: Commit & Push
```bash
git add .
git commit -m "chore: update project structure v2.0"
git push
```
- [ ] Push הצליח ללא שגיאות

### שלב 3: יצירת פרויקט Railway
- [ ] נכנסתי ל-https://railway.app
- [ ] לחצתי **New Project**
- [ ] בחרתי **Deploy from GitHub**
- [ ] בחרתי את הריפו

### שלב 4: הוספת PostgreSQL
- [ ] לחצתי **+ New** בפרויקט
- [ ] בחרתי **Database** → **PostgreSQL**
- [ ] המתנתי עד ש-DB פעיל (כ-1 דקה)
- [ ] בדקתי שיש `DATABASE_URL` ב-Variables

### שלב 5: הגדרת משתנים
בטאב **Variables** של ה-Web Service:
- [ ] `NODE_ENV=production`
- [ ] `PORT=3000` (אופציונלי)
- [ ] `DATABASE_URL` קיים (אוטומטי)

### שלב 6: אתחול DB (פעם אחת!)
**אופציה A - דרך Settings:**
- [ ] **Settings** → **Deploy** → **Start Command**
- [ ] שיניתי ל-: `npm run init-db && npm start`
- [ ] **Redeploy**
- [ ] בדקתי בלוגים שרץ: "DB initialized successfully"
- [ ] החזרתי Start Command ל-: `npm start`
- [ ] **Redeploy** שוב

**אופציה B - דרך Railway CLI:**
```bash
railway login
railway link
railway run npm run init-db
```
- [ ] הפקודה הצליחה

### שלב 7: בדיקת הפריסה
- [ ] לחצתי על ה-URL שRailway יצר
- [ ] בדקתי `/health` - מחזיר status: ok
- [ ] בדקתי `/api/debug`:
  - [ ] database.connected: true
  - [ ] database.ssl: true
  - [ ] database.productsCount: מספר (יכול להיות 0)

### שלב 8: טעינת נתונים (אופציונלי)
**אל תריץ סקרייפר בענן!** במקום זה:

**אופציה A - העתקה מלוקאל:**
```bash
# גבה מלוקאל
pg_dump postgresql://postgres:password@localhost:5432/lookli > backup.sql

# העלה לענן
railway run psql < backup.sql
```
- [ ] הנתונים הועתקו

**אופציה B - סקרייפר בלוקאל מול Railway DB:**
- [ ] העתקתי DATABASE_URL מRailway
- [ ] עדכנתי זמנית את .env בלוקאל
- [ ] הרצתי `npm run scrape`
- [ ] החזרתי .env ללוקאל

---

## 🔍 בדיקות סופיות

### Local
- [ ] `npm start` עובד
- [ ] `npm run db:start` עובד
- [ ] `npm run scrape` עובד
- [ ] כל ה-endpoints עובדים:
  - [ ] /
  - [ ] /health
  - [ ] /api/debug
  - [ ] /api/products
  - [ ] /api/filters

### Cloud
- [ ] האתר נגיש ב-URL
- [ ] /health מחזיר OK
- [ ] /api/debug מראה DB connected
- [ ] /api/products מחזיר נתונים (אם טענת)
- [ ] אין שגיאות בלוגים

---

## 📊 Performance Check

### Local
```bash
# זמן תגובה
time curl http://localhost:3000/health

# מספר מוצרים
curl http://localhost:3000/api/debug | jq '.database.productsCount'
```
- [ ] תגובה מתחת ל-100ms
- [ ] מספר מוצרים תקין

### Cloud
```bash
# זמן תגובה
time curl https://your-app.railway.app/health

# מספר מוצרים
curl https://your-app.railway.app/api/debug | jq '.database.productsCount'
```
- [ ] תגובה מתחת ל-500ms (ענן יותר איטי)
- [ ] מספר מוצרים תקין

---

## 🔐 Security Checklist

- [ ] .env לא בגיט
- [ ] אין credentials בקוד
- [ ] DATABASE_URL לא בלוגים
- [ ] Railway variables מוגדרים כראוי
- [ ] SSL פעיל (בענן)

---

## 📝 Documentation Checklist

- [ ] קראתי את README.md
- [ ] קראתי את QUICKSTART.md
- [ ] יש לי bookmark ל-TROUBLESHOOTING.md
- [ ] הבנתי את LOCAL_VS_CLOUD.md

---

## 🎉 Done!

אם עברת את כל ה-checkboxes:
- ✅ הפרויקט עובד בלוקאל
- ✅ הפרויקט עובד בענן
- ✅ יש לך DB מלא
- ✅ אתה יודע איך לעבוד

---

## 🚨 אם משהו לא עבד

1. **עצור!** אל תמשיך הלאה
2. **בדוק** את TROUBLESHOOTING.md
3. **שמור logs:**
   ```bash
   npm start 2>&1 > local_error.log
   railway logs > cloud_error.log
   ```
4. **שאל עזרה** עם הלוגים

---

## 📞 Support

- 📖 תיעוד: README.md
- 🚀 התחלה: QUICKSTART.md
- 🐛 בעיות: TROUBLESHOOTING.md
- ⚖️ השוואה: LOCAL_VS_CLOUD.md

**Good luck! 🍀**
