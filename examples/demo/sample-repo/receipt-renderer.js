export function makeReceipt({ orderId, items, payment }) {
  const lines = items.map((item) => `${item.quantity} × ${item.sku}`);
  return {
    orderId,
    lines,
    paymentStatus: payment.status,
    paymentReference: payment.reference,
  };
}

export function toPlainText(receipt) {
  return [`Order ${receipt.orderId}`, ...receipt.lines].join('\n');
}
