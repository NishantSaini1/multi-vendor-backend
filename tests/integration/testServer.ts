import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

let mongoServer: MongoMemoryReplSet | undefined;

// A single-node replica set (not a plain standalone MongoMemoryServer) — required
// so that multi-document transactions (used by the Inventory reserve/release and
// order-creation flows) actually work under test, matching how MongoDB is
// normally deployed in production (even single-node clusters are replica sets).
export async function startTestDatabase(): Promise<void> {
  // The 10s default launch timeout is too tight on a loaded machine
  // (emulator/Gradle running alongside) and fails whole suites spuriously.
  mongoServer = await MongoMemoryReplSet.create({ replSet: { count: 1 }, instanceOpts: [{ launchTimeout: 60_000 }] });
  await mongoose.connect(mongoServer.getUri());
  // mongoose.connect() resolves as soon as the connection is up — each
  // model's autoIndex build then runs fire-and-forget in the background, so
  // a query issued right after connecting can race ahead of it (most visible
  // on the four $text-indexed collections: "text index required for $text
  // query", MongoServerError code 27). Model.init() resolves once that one
  // model's indexes are actually built; awaiting all of them here closes the
  // race for every test rather than one at a time as it's hit.
  await Promise.all(mongoose.modelNames().map((name) => mongoose.model(name).init()));
}

export async function stopTestDatabase(): Promise<void> {
  await mongoose.connection.dropDatabase();
  await mongoose.connection.close();
  await mongoServer?.stop();
}
