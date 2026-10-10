const MAX_CLAIM_ATTEMPTS = 3;
const queue = [];

export function enqueueFulfillment(orderId, receiptReference) {
  const job = { orderId, receiptReference, attempts: 0, status: 'queued' };
  queue.push(job);
  return job;
}

export function pollNextJob() {
  return queue.find((job) => job.status === 'queued') || null;
}

export function claimJob(job) {
  job.attempts += 1;
  if (job.attempts >= MAX_CLAIM_ATTEMPTS) {
    job.status = 'blocked';
    return { claimed: false, blocked: true };
  }
  job.status = 'claimed';
  return { claimed: true, blocked: false };
}

export function markFulfilled(job, receiptReference) {
  job.status = 'fulfilled';
  job.receiptReference = receiptReference;
  return job;
}
