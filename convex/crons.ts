import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval(
  "cleanup stale tables and abandoned games",
  { minutes: 15 },
  internal.games.cleanupStaleGames,
);

export default crons;
