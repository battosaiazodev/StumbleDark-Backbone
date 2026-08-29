import { config } from "dotenv";
config();

import "./Handlers/Server";

// ─── Graceful Shutdown ────────────────────────────────────────────────────────
// يوقف كل الـ services بشكل نظيف عند إيقاف السيرفر

import { TournamentScheduler } from "./Handlers/Scheduler";
import { TournamentCleaner } from "./Handlers/Deleter";
import { StopLoop } from "./Backbone/Logic/Internal/Resolving";
import { Bot } from "./Handlers/Bot";
import { mongoose } from "./Handlers/Server";

async function shutdown(signal: string) {
  console.log(`\n[Shutdown] Received ${signal}. Shutting down gracefully...`);

  try {
    TournamentScheduler.Stop();
    TournamentCleaner.Stop();
    StopLoop();

    if (Bot.isReady()) {
      await Bot.destroy();
      console.log("[Shutdown] Discord bot disconnected.");
    }

    await mongoose.disconnect();
    console.log("[Shutdown] Database disconnected.");

    console.log("[Shutdown] Done. Goodbye!");
    process.exit(0);
  } catch (err) {
    console.error("[Shutdown] Error during shutdown:", err);
    process.exit(1);
  }
}

process.on("SIGINT",  () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

process.on("uncaughtException", (err) => {
  console.error("[FATAL] Uncaught Exception:", err);
  shutdown("uncaughtException");
});

process.on("unhandledRejection", (reason) => {
  console.error("[FATAL] Unhandled Rejection:", reason);
});
