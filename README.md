# LOOKLI - Fashion Search Engine

מנוע חיפוש אופנה צנועה חכם

## 📁 מבנה הקבצים

```
lookli/
├── public/
│   ├── index.html      # דף הבית
│   ├── about.html      # דף אודות
│   ├── contact.html    # דף צור קשר
│   └── lookli-logo.png  # לוגו
├── index.js            # שרת Node.js
├── package.json        # תלויות
├── schema.sql          # סכמת DB
├── Dockerfile          # להעלאה בדוקר
├── .env.example        # דוגמה למשתני סביבה
└── .gitignore
```

---

## 🚀 העלאה לענן - Railway (מומלץ!)

### שלב 1: הכנה
1. צור חשבון ב-[Railway](https://railway.app) (חינם עם GitHub)
2. העלה את הקוד ל-GitHub repository

### שלב 2: יצירת פרויקט
1. לחץ "New Project" ב-Railway
2. בחר "Deploy from GitHub repo"
3. בחר את ה-repository שלך

### שלב 3: הוספת Database
1. לחץ "+ New" → "Database" → "PostgreSQL"
2. Railway יוסיף אוטומטית את `DATABASE_URL`

### שלב 4: הרצת סכמה
1. לחץ על ה-PostgreSQL service
2. לך ל-tab "Data"
3. העתק והדבק את התוכן של `schema.sql`

### שלב 5: הגדרות
1. לחץ על השרת (index.js service)
2. הוסף Variables:
   - `NODE_ENV` = `production`

### שלב 6: Deploy!
Railway יעשה deploy אוטומטי. תקבל URL כמו:
`https://lookli-production.up.railway.app`

---

## 🔧 הגדרות נדרשות

### משתני סביבה (Environment Variables)

```env
# חובה - אחד מהם:
DATABASE_URL=postgresql://user:pass@host:5432/dbname

# או בנפרד:
DB_USER=postgres
DB_PASSWORD=your_password
DB_HOST=your-db-host.railway.app
DB_PORT=5432
DB_NAME=railway

# אופציונלי:
PORT=3000
NODE_ENV=production
```

---

## 🏃 הרצה מקומית

```bash
# התקנת תלויות
npm install

# הגדרת משתני סביבה
cp .env.example .env
# ערוך את .env עם הפרטים שלך

# הרצה
npm start

# או עם nodemon (development)
npm run dev
```

---

## 📊 ייבוא נתונים

אחרי שה-DB מוכן, תצטרך להעלות את הנתונים שלך:

### אפשרות 1: Export/Import
```bash
# מהמחשב המקומי - export
pg_dump -h localhost -U postgres fashion_aggregator > backup.sql

# לענן - import
psql DATABASE_URL < backup.sql
```

### אפשרות 2: הרצת הסקרייפר
העלה גם את `mekimi_scraper_fixed.js` והרץ אותו עם ה-DB החדש.

---

## ⚠️ לזכור

1. **מספר וואטסאפ**: שנה `972500000000` למספר האמיתי שלך
2. **לוגו**: ודא שהקובץ `lookli-logo.png` קיים ב-public
3. **SSL**: Railway מספק HTTPS אוטומטית
4. **Domain**: אפשר להוסיף domain מותאם אישית

---

## 🆘 פתרון בעיות

### "Cannot connect to database"
- ודא ש-DATABASE_URL מוגדר נכון
- בדוק שה-PostgreSQL service רץ

### "Module not found"
- הרץ `npm install`
- ודא ש-package.json קיים

### "Port already in use"
- Railway מגדיר PORT אוטומטית
- אל תשנה את PORT ב-code

---

## 📞 תמיכה

יש בעיה? צור קשר דרך:
- GitHub Issues
- WhatsApp (המספר באתר)
