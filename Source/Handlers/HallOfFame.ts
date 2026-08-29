import { BackboneUser } from "../Models/BackboneUser";

const HALL_OF_FAME_WEBHOOK = process.env.HALL_OF_FAME_WEBHOOK  || process.env.WEBHOOK_URI || "";
const LEADERBOARD_WEBHOOK  = process.env.LEADERBOARD_WEBHOOK   || process.env.WEBHOOK_URI || "";

const MEDALS = ["🥇", "🥈", "🥉"];
const PLACES = ["1st Place", "2nd Place", "3rd Place"];

const TITLES: Record<number, string> = {
  1:  "Newcomer",
  3:  "Competitor",
  5:  "Veteran",
  10: "Champion",
  20: "Legend",
  50: "God",
};

function getTitle(wins: number): string {
  const thresholds = Object.keys(TITLES).map(Number).sort((a, b) => b - a);
  for (const t of thresholds) {
    if (wins >= t) return TITLES[t];
  }
  return "Newcomer";
}

function buildBar(wins: number, max: number, length = 10): string {
  const filled = max > 0 ? Math.round((wins / max) * length) : 0;
  return "█".repeat(filled) + "░".repeat(length - filled);
}

function getWebhookUrl(uri: string): string {
  return uri.startsWith("https://discord.com/api/webhooks/")
    ? uri.replace("https://discord.com/api/webhooks/", "https://discord.com/api/v10/webhooks/")
    : uri;
}

// ─── Hall of Fame: فائزو بطولة معينة (مركز 1، 2، 3) ─────────────────────────
export async function SendHallOfFame(opts: {
  tournamentId:    string;
  tournamentName:  string;
  tournamentColor?: string;
  tournamentImage?: string;
}): Promise<void> {
  if (!HALL_OF_FAME_WEBHOOK) return;

  try {
    const { tournamentId, tournamentName, tournamentColor, tournamentImage } = opts;

    // جلب اللاعبين المرتبين حسب FinalPlace في هذه البطولة
    const players = await BackboneUser.find({
      [`Tournaments.${tournamentId}.SignedUp`]: true,
      [`Tournaments.${tournamentId}.FinalPlace`]: { $gt: 0 },
    })
      .select("Username UserId Tournaments")
      .lean();

    const sorted = players
      .map((p) => {
        const data = (p as any).Tournaments?.[tournamentId] ||
                     (p as any).Tournaments?.get?.(tournamentId);
        return {
          username:   (p as any).Username as string,
          userId:     (p as any).UserId as string,
          finalPlace: (data?.FinalPlace as number) || 999,
        };
      })
      .filter((p) => p.finalPlace > 0 && p.finalPlace <= 3)
      .sort((a, b) => a.finalPlace - b.finalPlace)
      .slice(0, 3);

    // fallback: Winners array
    if (sorted.length === 0) {
      const { Tournament } = await import("../Models/Tournament");
      const tour = await Tournament.findOne({ TournamentId: tournamentId }).lean();
      const winners = (tour as any)?.Winners || [];
      if (winners.length === 0) return;
      winners.slice(0, 3).forEach((w: any, i: number) => {
        sorted.push({ username: w.nick, userId: w.userId, finalPlace: i + 1 });
      });
    }

    if (sorted.length === 0) return;

    const hexColor   = (tournamentColor || "#ffd700").replace("#", "");
    const colorValue = parseInt(hexColor.substring(0, 6), 16) || 0xffd700;

    const podiumLines = sorted.map((p) => {
      const idx   = p.finalPlace - 1;
      const medal = MEDALS[idx] || `**#${p.finalPlace}**`;
      const place = PLACES[idx] || `#${p.finalPlace}`;
      return `${medal} **${place}**\n> \`${p.userId}\` — **${p.username}**`;
    });

    const payload = {
      embeds: [
        {
          title: "🏛️ Hall of Fame",
          description:
            `### 🏆 ${tournamentName}\n` +
            `The tournament has ended! Here are the top players:\n\n` +
            podiumLines.join("\n\n"),
          color:     colorValue,
          thumbnail: tournamentImage ? { url: tournamentImage } : undefined,
          footer:    { text: `Tournament ID: ${tournamentId}` },
          timestamp: new Date().toISOString(),
        },
      ],
    };

    const response = await fetch(getWebhookUrl(HALL_OF_FAME_WEBHOOK), {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(payload),
    });

    if (!response.ok) {
      console.error(`[HallOfFame] Webhook failed (${response.status}): ${await response.text()}`);
    }
  } catch (err) {
    console.error("[HallOfFame] Error:", err);
  }
}

// ─── All-Time Leaderboard: أفضل 30 لاعب كل الوقت (3 embeds × 10) ─────────────
export async function SendAllTimeLeaderboard(): Promise<void> {
  if (!LEADERBOARD_WEBHOOK) return;

  try {
    const top30 = await BackboneUser.find({ TournamentsWon: { $gt: 0 } })
      .sort({ TournamentsWon: -1 })
      .limit(30)
      .select("Username UserId TournamentsWon")
      .lean();

    if (top30.length === 0) return;

    const maxWins = (top30[0] as any).TournamentsWon as number;

    // نقسم الـ 30 لاعب على 3 embeds (كل embed 10 لاعبين)
    const chunks: typeof top30[] = [
      top30.slice(0, 10),
      top30.slice(10, 20),
      top30.slice(20, 30),
    ].filter((c) => c.length > 0);

    const embeds = chunks.map((chunk, chunkIndex) => {
      const startRank = chunkIndex * 10 + 1;

      const lines = chunk.map((p, i) => {
        const rank  = startRank + i;
        const wins  = (p as any).TournamentsWon as number;
        const bar   = buildBar(wins, maxWins);
        const title = getTitle(wins);
        const medal = rank <= 3 ? MEDALS[rank - 1] : `**${rank}.**`;
        return (
          `${medal} **${(p as any).Username}** — *${title}*\n` +
          `> \`${bar}\` **${wins} 🏆**`
        );
      });

      return {
        title:       chunkIndex === 0 ? "🌟 All-Time Leaderboard" : `🌟 Leaderboard (cont.)`,
        description: lines.join("\n\n"),
        color:       chunkIndex === 0 ? 0xffd700 : chunkIndex === 1 ? 0xc0c0c0 : 0xcd7f32,
        footer:      { text: `Ranks ${startRank}–${startRank + chunk.length - 1} • Updated after every tournament` },
        timestamp:   new Date().toISOString(),
      };
    });

    const payload = { embeds };

    const response = await fetch(getWebhookUrl(LEADERBOARD_WEBHOOK), {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(payload),
    });

    if (!response.ok) {
      console.error(`[Leaderboard] Webhook failed (${response.status}): ${await response.text()}`);
    }
  } catch (err) {
    console.error("[Leaderboard] Error:", err);
  }
}
