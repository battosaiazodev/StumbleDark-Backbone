import { Router } from "express";
import j from "joi";
import { ValidateBody, ValidateHeaders } from "../../Modules/Middleware";
import { LPUser } from "../../Models/LPUser";
import { BackboneUser } from "../../Models/BackboneUser";
import { Tournament } from "../../Models/Tournament";
import { Match } from "../../Models/Matches";

const App = Router();

const HeaderSchema = j
  .object({
    backbone_app_id: j.string().required().valid("8561191D-03B7-423E-B779-D2F6E77A3A45"),
    "x-unity-version": j.string().required(),
    access_token: j.string().required(),
  })
  .unknown(true);

const BodySchema = j
  .object({
    accessToken: j.string().required(),
    targetUserId: j.string().optional(),
  })
  .unknown(true);

/**
 * POST /tournamentPlayerStats
 * يرجع إحصائيات شاملة للاعب (نفسه أو لاعب آخر)
 */
App.post("/tournamentPlayerStats", ValidateHeaders(HeaderSchema), ValidateBody(BodySchema), async (req, res) => {
  try {
    const LPAccount = await LPUser.findOne({ AccessToken: req.body.accessToken }).lean();
    if (!LPAccount) return res.status(401).json({ message: "Unauthorized" });

    // إذا طلب بيانات لاعب آخر نستخدم targetUserId، وإلا نستخدم نفسه
    const targetId = req.body.targetUserId || LPAccount.UserId;

    const Player = await BackboneUser.findOne({ UserId: targetId }).lean();
    if (!Player) return res.status(404).json({ message: "Player not found" });

    // ─── حساب الإحصائيات ──────────────────────────────────────────────────
    const tournamentsMap = (Player.Tournaments as any) instanceof Map
      ? Object.fromEntries((Player.Tournaments as any).entries())
      : (Player.Tournaments as any) || {};

    const entries = Object.entries(tournamentsMap) as [string, any][];

    let totalSignups    = 0;
    let totalWins       = 0;
    let totalMatches    = 0;
    let totalMatchWins  = 0;
    let totalMatchLoses = 0;
    let bestPlace       = 9999;
    const recentTournaments: any[] = [];

    for (const [tourId, data] of entries) {
      if (!data?.SignedUp) continue;
      totalSignups++;

      if (data.FinalPlace > 0 && data.FinalPlace < bestPlace) {
        bestPlace = data.FinalPlace;
      }

      // إحصائيات المباريات من UserMatches
      if (Array.isArray(data.UserMatches)) {
        for (const match of data.UserMatches) {
          totalMatches++;
          const userInMatch = match.users?.find((u: any) => u["@user-id"] === targetId);
          if (userInMatch?.["@match-winner"] === "1") totalMatchWins++;
          else totalMatchLoses++;
        }
      }

      // آخر 5 بطولات
      if (recentTournaments.length < 5) {
        const tourDoc = await Tournament.findOne({ TournamentId: tourId })
          .select("TournamentName TournamentColor StartTime Status")
          .lean();
        if (tourDoc) {
          recentTournaments.push({
            tournamentId:   tourId,
            tournamentName: (tourDoc as any).TournamentName,
            color:          (tourDoc as any).TournamentColor,
            startTime:      (tourDoc as any).StartTime,
            status:         (tourDoc as any).Status,
            finalPlace:     data.FinalPlace || 0,
          });
        }
      }
    }

    totalWins = Player.TournamentsWon ?? 0;

    const winRate = totalMatches > 0
      ? Math.round((totalMatchWins / totalMatches) * 100)
      : 0;

    return res.status(200).json({
      userId:          Player.UserId,
      username:        Player.Username,
      stats: {
        tournamentsWon:   totalWins,
        tournamentsPlayed: totalSignups,
        bestPlace:        bestPlace === 9999 ? null : bestPlace,
        totalMatches,
        matchWins:        totalMatchWins,
        matchLoses:       totalMatchLoses,
        winRate:          `${winRate}%`,
      },
      recentTournaments,
    });
  } catch (err) {
    console.error("[PlayerStats] Error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
});

export default {
  App,
  DefaultAPI: "/api/v1",
};
