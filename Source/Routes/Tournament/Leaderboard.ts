import { Router } from "express";
import j from "joi";
import { ValidateBody, ValidateHeaders } from "../../Modules/Middleware";
import { BackboneUser } from "../../Models/BackboneUser";
import { Tournament } from "../../Models/Tournament";

const App = Router();

const LeaderboardSchema = j
  .object({
    backbone_app_id: j.string().required().valid("8561191D-03B7-423E-B779-D2F6E77A3A45"),
    "x-unity-version": j.string().required(),
    access_token: j.string().required(),
  })
  .unknown(true);

const LeaderboardBodySchema = j
  .object({
    maxResults: j.number().integer().min(1).max(100).default(50),
    page: j.number().integer().min(1).default(1),
    accessToken: j.string().required(),
  })
  .unknown(true);

/**
 * GET /tournamentLeaderboard
 * يرجع أفضل اللاعبين مرتبين حسب عدد البطولات المكسوبة
 */
App.post("/tournamentLeaderboard", ValidateHeaders(LeaderboardSchema), ValidateBody(LeaderboardBodySchema), async (req, res) => {
  try {
    const maxResults = Number(req.body.maxResults) || 50;
    const page       = Number(req.body.page) || 1;
    const skip       = (page - 1) * maxResults;

    const [total, players] = await Promise.all([
      BackboneUser.countDocuments({ TournamentsWon: { $gt: 0 } }),
      BackboneUser.find({ TournamentsWon: { $gt: 0 } })
        .sort({ TournamentsWon: -1 })
        .skip(skip)
        .limit(maxResults)
        .select("Username UserId TournamentsWon")
        .lean(),
    ]);

    const leaderboard = players.map((p, i) => ({
      rank:           skip + i + 1,
      userId:         p.UserId,
      username:       p.Username,
      tournamentsWon: p.TournamentsWon ?? 0,
    }));

    return res.status(200).json({
      pagination: {
        totalResultCount: total,
        maxResults,
        currentPage: page,
      },
      leaderboard,
    });
  } catch (err) {
    console.error("[Leaderboard] Error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
});

export default {
  App,
  DefaultAPI: "/api/v1",
};
