import { PrismaClient } from "@generated/prisma";
import { PrismaD1 } from "@prisma/adapter-d1";

export type * from "@generated/prisma";

export let db: PrismaClient;

let dbPromise: Promise<PrismaClient> | undefined;

// context(justinvdm, 21-05-2025): We need to instantiate the client via a
// function rather that at the module level for several reasons:
// * For prisma-client-js generator or cases where there are dynamic import to
//   the prisma wasm modules, we need to make sure we are instantiating the
//   prisma client later in the flow when the wasm would have been initialized
// * So that we can encapsulate workarounds, e.g. see `SELECT 1` workaround
//   below
//
// context: instantiate the client once per isolate. Rebuilding it every
// request re-instantiated the D1 wasm query engine, which crashed with
// "memory access out of bounds". Concurrent requests share a single init
// promise, and `db` is only assigned after the warmup succeeds; a failed
// warmup resets the promise so the next request retries rather than leaving
// the isolate stuck with a broken client.
export const setupDb = async (env: Env) => {
  if (!dbPromise) {
    dbPromise = (async () => {
      const client = new PrismaClient({
        // context(justinvdm, 21-05-2025): prisma-client generated type appears
        // to consider D1 adapter incompatible, though in runtime (dev and
        // production) it works
        // @ts-ignore
        adapter: new PrismaD1(env.DB),
      });

      // context(justinvdm, 21-05-2025): https://github.com/cloudflare/workers-sdk/pull/8283
      await client.$queryRaw`SELECT 1`;

      return client;
    })().catch((error) => {
      dbPromise = undefined;
      throw error;
    });
  }

  db = await dbPromise;
};
