import dns from 'dns';
import mongoose from 'mongoose';
import { env } from './env';
import { logger } from '../utils/logger';

// mongodb+srv:// URIs need SRV/TXT DNS lookups. Node's bundled resolver
// (c-ares) sometimes can't reach the OS-configured nameserver for these
// record types even though the OS's own resolver (nslookup, PowerShell)
// has no trouble with it — a known issue on some Windows/VPN/corporate
// networks. Falling back to a public resolver for SRV connection strings
// avoids "querySrv ECONNREFUSED" in that situation.
if (env.MONGO_URI.startsWith('mongodb+srv://')) {
  dns.setServers([...dns.getServers(), '8.8.8.8', '1.1.1.1']);
}

mongoose.set('strictQuery', true);

export async function connectDatabase(): Promise<void> {
  mongoose.connection.on('connected', () => logger.info('MongoDB connected'));
  mongoose.connection.on('error', (err) => logger.error({ err }, 'MongoDB connection error'));
  mongoose.connection.on('disconnected', () => logger.warn('MongoDB disconnected'));

  await mongoose.connect(env.MONGO_URI);
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.connection.close();
}

export function isDatabaseConnected(): boolean {
  return mongoose.connection.readyState === 1;
}
