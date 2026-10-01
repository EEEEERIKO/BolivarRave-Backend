import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

// Prefer DIRECT_URL for Prisma queries to avoid pooler timeouts on auth-critical routes.
const databaseUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) {
	throw new Error("DATABASE_URL o DIRECT_URL no esta configurada");
}

const adapter = new PrismaPg({ connectionString: databaseUrl });

export const prisma = new PrismaClient({
	adapter,
});
