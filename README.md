# AISHA HOME V2 backend

## Ishlash holati va Render

`GET /api/health/live` server ishlayotganida 200 qaytaradi; Render Health Check Path uchun shu yo‘ldan foydalaning. `GET /api/health/ready` MongoDB ulanganida 200, ulanmaganida 503 qaytaradi. Eski `/api/health` moslik uchun saqlangan. Readiness ulanish holatini bildiradi, yozish huquqi yoki tranzaksiyalarni tekshirmaydi. Server boshlang‘ich ulanish muvaffaqiyatsiz bo‘lsa 30 soniyada qayta urinadi; ulanish keyin uzilsa MongoDB driver qayta ulanishga harakat qiladi. Productionda `POST /api/orders` doim 503 bilan o‘chirilgan. Lokal test rejimida buyurtma oqimi o‘zgarmagan.

Render Environment ichida `MONGODB_URI`, ixtiyoriy `MONGODB_DB_NAME` va `NODE_ENV=production` ni tekshiring; secretlarni log yoki xabarlarga qo‘ymang. `MONGODB_DB_NAME` ko‘rsatilsa URI dagi bazadan ustun turadi. Render servisining Connect > Outbound bo‘limidagi barcha mintaqaviy IP diapazonlarini Atlas Network Access ro‘yxati bilan solishtiring. Atlas Database Access’dagi foydalanuvchining faqat kerakli bazaga tegishli huquqlarini va cluster holatini tekshiring. TLS tekshiruvini o‘chirmang. O‘zgarishlar GitHub va Renderga alohida chiqarilmaguncha bu lokal kod productionga ta’sir qilmaydi.
Express va MongoDB demo katalog va buyurtma API. Admin yozish API va autentifikatsiya mavjud emas. Buyurtma yaratish MongoDB replica set tranzaksiyasini talab qiladi; standalone da 503 qaytaradi. Narx va demo yetkazish serverda hisoblanadi; buyurtmalar HttpOnly cookie sessiyasiga bog‘lanadi. Yetkazish 15 000 so‘m, pickup 0 — faqat demo. To‘lov yoki buyurtmani bekor qilish hali mavjud emas. Haqiqiy savdo uchun internetga deploy qilmang.

Mahalliy ishga tushirish: yuqoridagi README.md. Testlar: npm.cmd test; real replica set integratsiyasini ORDER_REPLICA_TEST=1, standalone testini ORDER_STANDALONE_TEST=1 bilan alohida mahalliy test serverlarida bajaring.
