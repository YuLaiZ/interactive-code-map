import { reserveIngredients } from './inventory-checker.js';
import { chargeCard } from './payment-gateway.js';
import { makeReceipt } from './receipt-renderer.js';

export function createOrder(input, dependencies = {}) {
  const reserve = dependencies.reserveIngredients || reserveIngredients;
  const charge = dependencies.chargeCard || chargeCard;
  const receipt = dependencies.makeReceipt || makeReceipt;
  const items = normalizeItems(input.items);
  const reservation = reserve(items);
  const payment = charge(input.paymentToken, reservation.totalCents);
  return receipt({ orderId: input.orderId, items, payment });
}

export function normalizeItems(items) {
  return (items || []).map((item) => ({
    sku: String(item.sku),
    quantity: Math.max(1, Number(item.quantity) || 1),
    unitCents: Number(item.unitCents) || 0,
  }));
}
