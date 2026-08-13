const CATALOG = new Map([
  ['espresso', { available: 12, unitCents: 280 }],
  ['oat-milk', { available: 8, unitCents: 90 }],
  ['croissant', { available: 5, unitCents: 350 }],
]);

export function reserveIngredients(items) {
  let totalCents = 0;
  for (const item of items) {
    const entry = CATALOG.get(item.sku);
    if (!entry || entry.available < item.quantity) {
      throw new Error(`Unavailable item: ${item.sku}`);
    }
    entry.available -= item.quantity;
    totalCents += item.quantity * entry.unitCents;
  }
  return { reserved: true, totalCents };
}
