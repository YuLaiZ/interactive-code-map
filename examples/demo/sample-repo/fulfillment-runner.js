import { pollNextJob, claimJob, markFulfilled } from './fulfillment-queue.js';
import { notifyCustomer } from './barista-notifier.js';

export function runDueFulfillment() {
  const job = pollNextJob();
  if (!job) {
    return null;
  }
  const claim = claimJob(job);
  if (!claim.claimed) {
    return { job, claim };
  }
  const notification = notifyCustomer(job.orderId, job.receiptReference);
  const fulfilled = markFulfilled(job, job.receiptReference);
  return { job: fulfilled, claim, notification };
}
