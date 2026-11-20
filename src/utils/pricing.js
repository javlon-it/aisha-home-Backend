export function discountedUnitPrice(price, percent) {
 if (!Number.isSafeInteger(price) || price < 0 || !Number.isInteger(percent) || percent < 0 || percent > 100) throw new TypeError('Invalid price or discount');
 const discountAmount = Number((BigInt(price) * BigInt(percent) + 50n) / 100n);
 return { originalPrice: price, discountPercent: percent, discountAmount, finalPrice: price - discountAmount };
}
