import type { ServerResponse } from 'http';

/** Resolves on `drain` or `close`, removing both listeners either way. */
export const drained = (res: ServerResponse) =>
  new Promise<void>((resolve) => {
    const done = () => {
      res.off('drain', done);
      res.off('close', done);
      resolve();
    };
    res.on('drain', done);
    res.on('close', done);
  });
