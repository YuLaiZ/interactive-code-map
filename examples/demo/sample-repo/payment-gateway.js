export function chargeCard(paymentToken, amountCents) {
  if (!paymentToken) {
    throw new Error('A payment token is required');
  }
  if (amountCents <= 0) {
    throw new Error('The charge amount must be positive');
  }
  return {
    status: 'accepted',
    reference: `demo-${amountCents}`,
  };
}

export function refundCard(reference) {
  return { status: 'refunded', reference };
}
