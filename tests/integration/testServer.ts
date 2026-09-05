import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

let mongoServer: MongoMemoryReplSet | undefined;

// A single-node replica set (not a plain standalone MongoMemoryServer) — required
// so that multi-document transactions (used by the Inventory reserve/release and
// order-creation flows) actually work under test, matching how MongoDB is
// normally deployed in production (even single-node clusters are replica sets).
export async function startTestDatabase(): Promise<void> {
  mongoServer = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongoServer.getUri());
}

export async function stopTestDatabase(): Promise<void> {
  await mongoose.connection.dropDatabase();
  await mongoose.connection.close();
  await mongoServer?.stop();
}
