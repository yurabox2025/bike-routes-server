import type { NextFunction, Request, Response } from 'express';

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  void _next;
  if (err instanceof Error) {
    console.error(err);
    res.status(400).json({ message: err.message });
    return;
  }

  res.status(500).json({ message: 'Unknown error' });
}
