import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
config({ path: ".env.test", override: true, quiet: true });

process.env.BETTER_AUTH_SECRET ??= "test-secret-test-secret-test-secret-00";
