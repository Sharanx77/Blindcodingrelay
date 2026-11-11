import "dotenv/config";
import { initializeDatabase, seedDatabase } from "./database.js";

await initializeDatabase();
seedDatabase();
console.info("Challenge templates are ready.");
