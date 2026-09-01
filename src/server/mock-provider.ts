import type { Request, Response } from 'express';

export interface MockResource {
  path: string;
  price: bigint;
  data: Record<string, unknown>;
}

export const RESOURCES: MockResource[] = [
  { path: '/api/data/flight-prices', price: 15n, data: { provider: 'midnight-airlines', prices: ['NYC->LON 499', 'LON->NYC 510'] } },
  { path: '/api/data/market-data', price: 20n, data: { provider: 'midnight-quote', ticker: 'MNIGHT', price: '1.02' } },
  { path: '/api/data/ai-inference', price: 30n, data: { provider: 'midnight-ai', model: 'shade-gpt', output: 'privacy-first answer' } },
];

export function findResource(path: string): MockResource {
  return RESOURCES.find((r) => r.path === path) ?? RESOURCES[0];
}

/** Issue an x402 payment-required challenge for a resource. */
export function buildChallenge(path: string): {
  id: string;
  amount: string;
  recipient: string;
  path: string;
  expiresAt: number;
} {
  const resource = findResource(path);
  return {
    id: `inv_${Date.now()}_${Math.floor(Math.random() * 1e9)}`,
    amount: resource.price.toString(),
    recipient: 'midnight_provider_example',
    path: resource.path,
    expiresAt: Math.floor(Date.now() / 1000) + 300,
  };
}

/** Simulated protected resource handler. 402 unless a receipt is presented. */
export function handleMockResource(req: Request, res: Response): void {
  const path = (req.query.path as string) ?? RESOURCES[0].path;
  const resource = findResource(path);
  const receipt = req.query.receipt as string | undefined;
  const invoiceId = req.query.invoiceId as string | undefined;

  if (receipt && invoiceId) {
    res.json({ ok: true, resource: resource.data });
    return;
  }

  res.status(402).json({
    type: 'x402-payment-required',
    invoice: buildChallenge(path),
  });
}
