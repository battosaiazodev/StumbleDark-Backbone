import { Router } from "express";
import j from "joi";
import rateLimit from "express-rate-limit";
import { ValidateBody, ValidateHeaders } from "../../Modules/Middleware";
import { Tournament } from "../../Models/Tournament";
import { Match } from "../../Models/Matches";
import { BackboneUser } from "../../Models/BackboneUser";
import { TournamentCleaner } from "../../Handlers/Deleter";
import { TournamentStatus } from "../../Backbone/Config";

const App = Router();

// ─── Rate limiter صارم على الـ Admin endpoints ────────────────────────────────
const AdminLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many admin requests." },
});

const AdminHeaderSchema = j
  .object({
    backbone_app_id: j.string().required().valid("8561191D-03B7-423E-B779-D2F6E77A3A45"),
    "x-unity-version": j.string().required(),
    "x-admin-key": j.string().required(),
  })
  .unknown(true);

// ─── التحقق من مفتاح الـ Admin ────────────────────────────────────────────────
function isAdminKey(key: string): boolean {
  const adminKey = process.env.ADMIN_API_KEY;
  if (!adminKey) return false;
  return key === adminKey;
}

// ─── GET /admin/tournaments — قائمة البطولات مع فلاتر ────────────────────────
App.post("/admin/tournaments", AdminLimiter, ValidateHeaders(AdminHeaderSchema), async (req, res) => {
  if (!isAdminKey(req.headers["x-admin-key"] as string)) {
    return res.status(403).json({ message: "Forbidden" });
  }

  try {
    const page       = Number(req.body.page) || 1;
    const maxResults = Number(req.body.maxResults) || 20;
    const status     = req.body.status !== undefined ? Number(req.body.status) : undefined;
    const search     = req.body.search as string | undefined;

    const query: any = {};
    if (status !== undefined) query.Status = status;
    if (search) query.TournamentName = { $regex: search, $options: "i" };

    const [total, tournaments] = await Promise.all([
      Tournament.countDocuments(query),
      Tournament.find(query)
        .sort({ StartTime: -1 })
        .skip((page - 1) * maxResults)
        .limit(maxResults)
        .lean(),
    ]);

    // إضافة عدد اللاعبين لكل بطولة
    const enriched = await Promise.all(
      tournaments.map(async (t) => {
        const playerCount = await BackboneUser.countDocuments({
          [`Tournaments.${t.TournamentId}`]: { $exists: true },
          [`Tournaments.${t.TournamentId}.SignedUp`]: true,
        });
        const matchCount = await Match.countDocuments({ tournamentid: t.TournamentId.toString() });
        return { ...t, playerCount, matchCount };
      })
    );

    return res.status(200).json({
      pagination: { totalResultCount: total, maxResults, currentPage: page },
      tournaments: enriched,
    });
  } catch (err) {
    console.error("[Admin] Error listing tournaments:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
});

// ─── POST /admin/tournament/cancel — إلغاء بطولة ─────────────────────────────
App.post("/admin/tournament/cancel", AdminLimiter, ValidateHeaders(AdminHeaderSchema), async (req, res) => {
  if (!isAdminKey(req.headers["x-admin-key"] as string)) {
    return res.status(403).json({ message: "Forbidden" });
  }

  const { tournamentId } = req.body;
  if (!tournamentId) return res.status(400).json({ message: "tournamentId is required" });

  try {
    const tour = await Tournament.findOne({ TournamentId: tournamentId.toString() });
    if (!tour) return res.status(404).json({ message: "Tournament not found" });

    await Tournament.updateOne(
      { TournamentId: tournamentId.toString() },
      { $set: { Status: TournamentStatus.Canceled } }
    );

    return res.status(200).json({ message: "Tournament canceled", tournamentId });
  } catch (err) {
    console.error("[Admin] Error canceling tournament:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
});

// ─── POST /admin/tournament/delete — حذف بطولة كاملاً ────────────────────────
App.post("/admin/tournament/delete", AdminLimiter, ValidateHeaders(AdminHeaderSchema), async (req, res) => {
  if (!isAdminKey(req.headers["x-admin-key"] as string)) {
    return res.status(403).json({ message: "Forbidden" });
  }

  const { tournamentId } = req.body;
  if (!tournamentId) return res.status(400).json({ message: "tournamentId is required" });

  try {
    const tour = await Tournament.findOne({ TournamentId: tournamentId.toString() });
    if (!tour) return res.status(404).json({ message: "Tournament not found" });

    await TournamentCleaner.DeleteTournamentData(tournamentId.toString());

    return res.status(200).json({ message: "Tournament and all data deleted", tournamentId });
  } catch (err) {
    console.error("[Admin] Error deleting tournament:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
});

// ─── POST /admin/tournament/kick — طرد لاعب ──────────────────────────────────
App.post("/admin/tournament/kick", AdminLimiter, ValidateHeaders(AdminHeaderSchema), async (req, res) => {
  if (!isAdminKey(req.headers["x-admin-key"] as string)) {
    return res.status(403).json({ message: "Forbidden" });
  }

  const { tournamentId, userId } = req.body;
  if (!tournamentId || !userId) {
    return res.status(400).json({ message: "tournamentId and userId are required" });
  }

  try {
    const tid    = tournamentId.toString();
    const player = await BackboneUser.findOne({ UserId: userId.toString() });
    if (!player) return res.status(404).json({ message: "Player not found" });

    const tourData = player.Tournaments.get(tid);
    if (!tourData?.SignedUp) {
      return res.status(400).json({ message: "Player is not signed up in this tournament" });
    }

    tourData.SignedUp = false;
    player.markModified(`Tournaments.${tid}`);

    await Promise.all([
      player.save(),
      Tournament.updateOne({ TournamentId: tid }, { $inc: { CurrentInvites: -1 } }),
    ]);

    return res.status(200).json({
      message: `Player ${player.Username} kicked from tournament ${tid}`,
      userId,
      tournamentId: tid,
    });
  } catch (err) {
    console.error("[Admin] Error kicking player:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
});

// ─── POST /admin/stats — إحصائيات عامة ──────────────────────────────────────
App.post("/admin/stats", AdminLimiter, ValidateHeaders(AdminHeaderSchema), async (req, res) => {
  if (!isAdminKey(req.headers["x-admin-key"] as string)) {
    return res.status(403).json({ message: "Forbidden" });
  }

  try {
    const [
      totalTournaments,
      runningTournaments,
      openTournaments,
      finishedTournaments,
      canceledTournaments,
      totalPlayers,
      totalMatches,
      activeMatches,
    ] = await Promise.all([
      Tournament.countDocuments(),
      Tournament.countDocuments({ Status: TournamentStatus.Running }),
      Tournament.countDocuments({ Status: TournamentStatus.InvitationOpen }),
      Tournament.countDocuments({ Status: TournamentStatus.Finished }),
      Tournament.countDocuments({ Status: TournamentStatus.Canceled }),
      BackboneUser.countDocuments(),
      Match.countDocuments(),
      Match.countDocuments({ status: { $in: [2, 3] } }),
    ]);

    const topPlayers = await BackboneUser.find({ TournamentsWon: { $gt: 0 } })
      .sort({ TournamentsWon: -1 })
      .limit(5)
      .select("Username UserId TournamentsWon")
      .lean();

    return res.status(200).json({
      tournaments: {
        total:    totalTournaments,
        running:  runningTournaments,
        open:     openTournaments,
        finished: finishedTournaments,
        canceled: canceledTournaments,
      },
      players: {
        total: totalPlayers,
      },
      matches: {
        total:  totalMatches,
        active: activeMatches,
      },
      topPlayers: topPlayers.map((p) => ({
        userId:         p.UserId,
        username:       p.Username,
        tournamentsWon: p.TournamentsWon,
      })),
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[Admin] Error fetching stats:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
});

export default {
  App,
  DefaultAPI: "/api/v1",
};
