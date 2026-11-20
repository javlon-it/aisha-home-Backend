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
Express va MongoDB katalog, buyurtma va admin API. Admin autentifikatsiyasi va mahsulot/ombor API mavjud. Buyurtma yaratish MongoDB replica set tranzaksiyasini talab qiladi; standalone da 503 qaytaradi. Yetkazish narxini sotuvchi mijoz bilan kelishadi: kelishilmaguncha yakuniy summa belgilanmaydi; o‘zi olib ketish narxi 0. Admin statistikasi `GET /api/admin/dashboard?period=daily|weekly|monthly|yearly&date=YYYY-MM-DD` orqali faqat bazadagi yakunlangan savdo va qaytarishlardan olinadi; vaqt zonasi Asia/Tashkent. Production buyurtma yaratish yopiq qoladi.

## Admin buyurtmalar

Autentifikatsiya va imzolangan proxy ortida `GET /api/admin/orders`, `GET /api/admin/orders/page/:page`, `GET /api/admin/orders/:id`, `PATCH /api/admin/orders/:id/status` (`{status}`) va `PATCH /api/admin/orders/:id/delivery-fee` (`{fee}`) mavjud. Sahifa 50 ta buyurtma qaytaradi. O‘tishlar: `Yangi` → `Jarayonda` → `Yakunlangan`; birinchi ikki holatdan `Bekor qilingan`ga o‘tish mumkin. Terminal holatlar qayta ochilmaydi. Pickup uchun yetkazish narxi faqat 0 bo‘ladi. O‘tgan 24 soatlik tasdiqlash muddati uchun yangi status yoki narx o‘zgartirilmaydi.

Bekor qilish va qoldiqni qaytarish bir MongoDB tranzaksiyasida bajariladi; takroriy yoki parallel bekor qilish bir xil qoldiqni ikki marta qaytarmaydi. Buyurtma yaratilgan vaqtdagi variant tannarxi admin/xaridor API javobidan yashiriladi va keyingi ombor kirimlari bo‘lsa, bekor qilishda qayta hisobga olinadi. Eski buyurtmada tannarx ma’lum bo‘lmasa, taxminiy qiymat chiqarilmaydi: qaytarilgan variantning o‘rtacha tannarxi noma’lum bo‘ladi. Tranzaksiya ishlashi uchun replica set kerak.

Server boshlanganda va ishlayotgan paytda har daqiqada 24 soatdan eski `Yangi` buyurtmalar tekshiriladi. Render Free uxlab qolganida jarayon ishlamaydi; uyg‘ongach muddati o‘tganlarni qayta ko‘rib chiqadi. Shuning uchun 24 soatning aynan o‘zida bekor qilish uchun tashqi, ishonchli jadval yoki doim ishlaydigan servis kerak; bu hali sozlanmagan. Qaytarib bo‘lmaydigan eski buyurtma avtomatik yakunlanmaydi, worker xato sonini loglaydi. Production ma’lumotlaridagi eski rezervlar va ishlatish huquqlari deploydan avval alohida baholansin.

## Do‘kondagi savdo va mijoz tarixi

Admin autentifikatsiyasi va imzolangan proxy ortida `POST /api/admin/sales` savdoni yaratadi, `GET /api/admin/sales` oxirgi 100 ta savdoni qaytaradi. Yaratishda majburiy `Idempotency-Key`, mijoz ismi va telefoni, `cash` yoki `card`, so‘mda individual chegirma va kamida bitta variant talab qilinadi. To‘lov usuli faqat qayd qilinadi: bu yerda karta to‘lovi yoki fiskal chek integratsiyasi yo‘q. Server narxni qayta tekshiradi; chegirma mahsulotlar summasidan oshmaydi.

Savdo, mijozga bog‘lanish va qoldiq kamayishi bir replica-set tranzaksiyasida bajariladi. Bir kalit bilan takroriy ayni so‘rov bitta savdo qaytaradi; boshqa ma’lumot bilan ayni kalit 409. Alohida yangi kalitlar alohida savdo sifatida qabul qilinadi. Har savdoda mahsulot nomi, SKU, variant, miqdor, sotuv narxi, tannarx, chegirma va yakuniy summa snapshot sifatida saqlanadi. Tannarxi noma’lum variantni sotish rad etiladi. Mijozning telefon raqami normallashtirilib, savdolar mijoz ID’siga bog‘lanadi. Telefon mavjud mijozga mos bo‘lsa, avval `CUSTOMER_CONFIRMATION_REQUIRED` javobi qaytadi; UI profilni aniq ko‘rsatib, operator tasdiqlamaguncha mijoz ulanmaydi va tranzaksiya bajarilmaydi. Bitta eski mos mijozni ham operator aniq tasdiqlashi kerak; bir nechta eski moslik xato bilan to‘xtaydi. CRM interfeysi hali yaratilmagan.

Mahsulot profilidagi `discountPercent` umumiy chegirmasi (0–100 foiz) savdo paytida serverda hisoblanadi. Savat bo‘yicha umumiy mahsulot chegirmasi individual so‘m chegirmasi bilan taqqoslanadi va ulardan kattasi qo‘llanadi; ular qo‘shilmaydi. Foizlar, narx, individual chegirma va yakuniy summa serverda tranzaksiya ichida qayta tekshiriladi. Savdoda umumiy/individual chegirma miqdori va qaysi biri qo‘llangani snapshot bo‘lib qoladi.

Mijoz `phoneKey` maydoni uchun sparse unique indeks va savdo kaliti uchun unique indeks kerak. Mavjud production mijozlari va indeks ruxsatlari deploydan oldin alohida tekshirilsin; bu kod production ma’lumotlarini ko‘chirmaydi yoki tozalab bermaydi. Mahalliy integratsiyalar faqat alohida sintetik bazalarda `ADMIN_SALE_TEST_MONGO` (replica set) va `ADMIN_SALE_STANDALONE_MONGO` (standalone) bilan ishlatiladi.

## Do‘kondagi mahsulot qaytarish

`POST /api/admin/sales/:saleId/returns` qaytarishni qayd etadi; `GET /api/admin/returns` oxirgi 100 ta qaytarishni ko‘rsatadi. Idempotency key qayta yuborilgan ayni so‘rovni takrorlamaydi. Server sotuvdagi miqdor va narx snapshotlarini tekshiradi. Chegirma savdo satrlariga mutanosib, deterministik ravishda taqsimlanadi; qisman qaytarishlar shu satrning sof to‘langan summasidan hisoblanadi va oxirgi qaytarishda satr summasining qoldig‘i aniq yopiladi. Qaytarilgan jami pul asl savdo summasidan oshmaydi.

Har bir qaytarishda sabab, server vaqti, mijoz, savdo satrlari va tarixiy tannarx saqlanadi. Sotishga yaroqli mahsulot omborga qo‘shiladi; yaroqsiz mahsulot faqat tarixga yoziladi. Qaytarish rekordi, sotilgan miqdor qaytgan ko‘rsatkichi va ombor o‘zgarishi bitta MongoDB tranzaksiyasida yoziladi. Tranzaksiya/replica set ishlamasa, hech biri saqlanmaydi. Tizim qaytariladigan summani qayd etadi, lekin pulni karta yoki naqd kanalida o‘zi jo‘natmaydi. Sintetik integratsiyalar `ADMIN_RETURN_TEST_MONGO` (replica set) va `ADMIN_RETURN_STANDALONE_MONGO` (standalone) bilan ishlaydi.

Mahalliy ishga tushirish: yuqoridagi README.md. Testlar: npm.cmd test; real replica set integratsiyasini ORDER_REPLICA_TEST=1, standalone testini ORDER_STANDALONE_TEST=1 bilan alohida mahalliy test serverlarida bajaring.

## CRM (9-bosqich)

Admin CRM mijozlarni ism/telefon bo‘yicha qidiradi va profilida internet buyurtmalari, jismoniy savdolar, xarid qilingan mahsulotlar, jami xaridlar, qaytarishlar hamda admin izohlarini ko‘rsatadi. CRM API admin sessiyasi bilan himoyalangan.
