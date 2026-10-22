import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
config({ path: ".env.test", override: true, quiet: true });
