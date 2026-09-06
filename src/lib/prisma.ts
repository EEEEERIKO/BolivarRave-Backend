import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

// Use the Supabase pooler for runtime queries. It is the reachable connection
// from the application environment; DIRECT_URL is reserved for migrations.
const databaseUrl = process.env.DATABASE_URL ?? process.env.DIRECT_URL;
if (!databaseUrl) {
	throw new Error("DATABASE_URL o DIRECT_URL no esta configurada");
}

const adapter = new PrismaPg({
	connectionString: databaseUrl,
	// Keep the pool small because Supabase's pooler is already managing
	// database connections and interactive transactions need one connection.
	max: 5,
	connectionTimeoutMillis: 30_000,
	idleTimeoutMillis: 30_000,
});

export const prisma = new PrismaClient({
	adapter,
	transactionOptions: {
		maxWait: 30_000,
		timeout: 30_000,
	},
});
