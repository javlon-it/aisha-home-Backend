import test from 'node:test';
import assert from 'node:assert/strict';
import {discountedUnitPrice} from '../src/utils/pricing.js';

test('product discount rounds consistently and validates inputs',()=>{
 assert.deepEqual(discountedUnitPrice(1001,15),{originalPrice:1001,discountPercent:15,discountAmount:150,finalPrice:851});
 assert.deepEqual(discountedUnitPrice(100,100),{originalPrice:100,discountPercent:100,discountAmount:100,finalPrice:0});
 assert.throws(()=>discountedUnitPrice(-1,10),TypeError);
 assert.throws(()=>discountedUnitPrice(10,101),TypeError);
});
