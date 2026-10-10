export function notifyCustomer(orderId, receiptReference) {
  return {
    orderId,
    receiptReference,
    channel: 'counter-display',
    notified: true,
  };
}

export function acknowledge(notification) {
  return { orderId: notification.orderId, acknowledged: true };
}
