# AISHA HOME V2 backend

## Supabase Storage konfiguratsiyasi

Backend muhitida `SUPABASE_URL`, `SUPABASE_SECRET_KEY` va `SUPABASE_STORAGE_BUCKET=products` sozlanadi. Secret kalit faqat backendda saqlansin. Kerakli qiymatlar bo‘lmasa yoki konfiguratsiya noto‘g‘ri bo‘lsa, storage klienti o‘chiriladi, qolgan API ishlashda davom etadi. Klient tayyorlanishi Supabase ulanishi yoki bucket mavjudligini tasdiqlamaydi. `@supabase/supabase-js` uchun Node.js 22 yoki undan yangi versiya talab qilinadi.

Server tinglashni boshlagach, `products` bucketiga faqat o‘qish so‘rovi bir marta yuboriladi. Natija `Supabase connection: PASS` yoki `Supabase connection: FAIL`; 10 soniyalik kutishdan so‘ng ham javob bo‘lmasa FAIL qayd etiladi. Tekshiruv server ishga tushishini to‘xtatmaydi va yozish ruxsatini tekshirmaydi.

FAIL logidagi xavfsiz sabab kodlari: `CONFIG_INVALID` — konfiguratsiya yetishmaydi yoki noto‘g‘ri; `AUTH_OR_PERMISSION` — HTTP 401/403, autentifikatsiya yoki ruxsat; `BUCKET_OR_ENDPOINT_NOT_FOUND` — HTTP 404; `HTTP_ERROR` — boshqa HTTP xato; `TIMEOUT` — javob kutilgan vaqtda kelmadi; `NETWORK_OR_CLIENT_ERROR` — tarmoq yoki klient xatosi; `INVALID_RESPONSE` — kutilmagan javob. Status mavjud bo‘lsa faqat raqam yoziladi; secretlar va server qaytargan matn logga yozilmaydi.

Ushbu muhit sozlangan backendda `node scripts/check-supabase.js` faqat `products` bucket metama’lumotini o‘qib, PASS yoki FAIL qaytaradi. U fayl yaratmaydi, yuklamaydi yoki o‘chirmaydi; PASS yozish ruxsati yoki bucket xavfsizlik siyosatini tasdiqlamaydi.

## Admin mahsulot va ombor

Admin autentifikatsiyasi bilan mahsulot, variant, kirim va rasm marshrutlari `/api/admin` ichida ishlaydi. Kirimda `Idempotency-Key` va MongoDB replica-set tranzaksiyasi talab qilinadi; miqdor, bir dona tannarx va sana alohida kirim yozuvida saqlanadi. O‘rtacha tannarx har kirimda hisoblanib, 4 kasr xonasigacha yaxlitlanadi. Avval mavjud qoldiqning tannarxi noma’lum bo‘lsa, birinchi kirimda uning boshlang‘ich tannarxi kiritilishi kerak. Qoldiq va tannarx katalog API javobiga kiritilmaydi.

Rasm maxsus admin proxy orqali binary ko‘rinishda uzatiladi; asl fayl va qayta ishlangan rasm 4 MiB dan oshmasligi, JPEG, PNG yoki WEBP bo‘lishi kerak. Yangi rasm muvaffaqiyatli bog‘langandan so‘ng eski Storage fayli o‘chiriladi; o‘chirish muvaffaqiyatsiz bo‘lsa admin ogohlantiriladi. `products` bucketdan mijoz rasmni ko‘rishi uchun u o‘qish uchun mos sozlangan bo‘lishi kerak. Haqiqiy Supabase yozish/o‘chirish va Vercel proxy ishlashi alohida tasdiqlanmagan.

## Ishlash holati va Render

`GET /api/health/live` server ishlayotganida 200 qaytaradi; Render Health Check Path uchun shu yo‘ldan foydalaning. `GET /api/health/ready` MongoDB ulanganida 200, ulanmaganida 503 qaytaradi. Eski `/api/health` moslik uchun saqlangan. Readiness ulanish holatini bildiradi, yozish huquqi yoki tranzaksiyalarni tekshirmaydi. Server boshlang‘ich ulanish muvaffaqiyatsiz bo‘lsa 30 soniyada qayta urinadi; ulanish keyin uzilsa MongoDB driver qayta ulanishga harakat qiladi. Productionda `POST /api/orders` doim 503 bilan o‘chirilgan. Lokal test rejimida buyurtma oqimi o‘zgarmagan.

Render Environment ichida `MONGODB_URI`, ixtiyoriy `MONGODB_DB_NAME` va `NODE_ENV=production` ni tekshiring; secretlarni log yoki xabarlarga qo‘ymang. `MONGODB_DB_NAME` ko‘rsatilsa URI dagi bazadan ustun turadi. Render servisining Connect > Outbound bo‘limidagi barcha mintaqaviy IP diapazonlarini Atlas Network Access ro‘yxati bilan solishtiring. Atlas Database Access’dagi foydalanuvchining faqat kerakli bazaga tegishli huquqlarini va cluster holatini tekshiring. TLS tekshiruvini o‘chirmang. O‘zgarishlar GitHub va Renderga alohida chiqarilmaguncha bu lokal kod productionga ta’sir qilmaydi.
Express va MongoDB demo katalog va buyurtma API. Admin autentifikatsiyasi va mahsulot/ombor API mavjud. Buyurtma yaratish MongoDB replica set tranzaksiyasini talab qiladi; standalone da 503 qaytaradi. Narx va demo yetkazish serverda hisoblanadi; buyurtmalar HttpOnly cookie sessiyasiga bog‘lanadi. Yetkazish 15 000 so‘m, pickup 0 — faqat demo. To‘lov yoki buyurtmani bekor qilish hali mavjud emas. Haqiqiy savdo uchun internetga deploy qilmang.

Mahalliy ishga tushirish: yuqoridagi README.md. Testlar: npm.cmd test; real replica set integratsiyasini ORDER_REPLICA_TEST=1, standalone testini ORDER_STANDALONE_TEST=1 bilan alohida mahalliy test serverlarida bajaring.
