import { Router } from "express";
import j from "joi";
import rateLimit from "express-rate-limit";
import { ValidateBody, ValidateHeaders } from "../../Modules/Middleware";
import { Tournament } from "../../Models/Tournament";
import { LPUser } from "../../Models/LPUser";
import { BackboneUser } from "../../Models/BackboneUser";

const App = Router();

const UnsignupLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
});

const HeaderSchema = j
  .object({
    backbone_app_id: j.string().required().valid("8561191D-03B7-423E-B779-D2F6E77A3A45"),
    "x-unity-version": j.string().required(),
    access_token: j.string().required(),
  })
  .unknown(true);

const BodySchema = j
  .object({
    tournamentId: j.number().required(),
    accessToken:  j.string().required(),
  })
  .unknown(true);

enum UnsignupStatus {
  Ok                     = 0,
  NotSignedUp            = 1,
  TournamentAlreadyStarted = 2,
  InvalidTournament      = 3,
  DatabaseError          = 4,
}

App.post(
  "/tournamentUnsignup",
  UnsignupLimiter,
  ValidateHeaders(HeaderSchema),
  ValidateBody(BodySchema),
  async (req, res) => {
    const TournamentId = req.body.tournamentId.toString();

    try {
      const [LPAccount, CheckTournament] = await Promise.all([
        LPUser.findOne({ AccessToken: req.body.accessToken }).lean(),
        Tournament.findOne({ TournamentId }).lean(),
      ]);

      if (!LPAccount) return res.status(401).json({ message: "Unauthorized" });

      if (!CheckTournament) {
        return res.status(200).json({ status: UnsignupStatus.InvalidTournament, tournamentId: TournamentId });
      }

      // لا يمكن الانسحاب بعد بدء البطولة
      const Now = new Date();
      if (Now >= new Date(CheckTournament.StartTime)) {
        return res.status(200).json({ status: UnsignupStatus.TournamentAlreadyStarted, tournamentId: TournamentId });
      }

      const DatabaseUser = await BackboneUser.findOne({ UserId: LPAccount.UserId });
      if (!DatabaseUser) {
        return res.status(200).json({ status: UnsignupStatus.DatabaseError, tournamentId: TournamentId });
      }

      const TournamentData = DatabaseUser.Tournaments.get(TournamentId);
      if (!TournamentData?.SignedUp) {
        return res.status(200).json({ status: UnsignupStatus.NotSignedUp, tournamentId: TournamentId });
      }

      // ─── إزالة اللاعب من الحفلة إذا كان في حفلة ──────────────────────────
      if (TournamentData.PartyCode && TournamentData.PartyMembers?.length > 1) {
        const isLeader = TournamentData.PartyMembers.find(
          (m: any) => m.IsPartyLeader && m.UserId === DatabaseUser.UserId
        );

        if (isLeader) {
          // إذا كان قائد الحفلة، نفكك الحفلة كلها
          const memberIds = TournamentData.PartyMembers
            .filter((m: any) => m.UserId !== DatabaseUser.UserId)
            .map((m: any) => m.UserId);

          if (memberIds.length > 0) {
            await BackboneUser.updateMany(
              { UserId: { $in: memberIds }, [`Tournaments.${TournamentId}`]: { $exists: true } },
              {
                $set: {
                  [`Tournaments.${TournamentId}.PartyCode`]: "",
                  [`Tournaments.${TournamentId}.PartyMembers`]: [],
                },
              }
            );
          }
        } else {
          // إذا كان عضواً عادياً، نحذفه من قائمة الحفلة
          const leaderUser = await BackboneUser.findOne({
            [`Tournaments.${TournamentId}.PartyCode`]: TournamentData.PartyCode,
            [`Tournaments.${TournamentId}.PartyMembers`]: {
              $elemMatch: { IsPartyLeader: true },
            },
          });

          if (leaderUser) {
            const leaderData = leaderUser.Tournaments.get(TournamentId);
            if (leaderData) {
              leaderData.PartyMembers = leaderData.PartyMembers.filter(
                (m: any) => m.UserId !== DatabaseUser.UserId
              );
              leaderUser.markModified(`Tournaments.${TournamentId}`);
              await leaderUser.save();
            }
          }
        }
      }

      // ─── إلغاء التسجيل ────────────────────────────────────────────────────
      TournamentData.SignedUp     = false;
      TournamentData.PartyCode    = "";
      TournamentData.PartyMembers = [];
      DatabaseUser.markModified(`Tournaments.${TournamentId}`);

      await Promise.all([
        DatabaseUser.save(),
        Tournament.updateOne({ TournamentId }, { $inc: { CurrentInvites: -1 } }),
      ]);

      return res.status(200).json({ status: UnsignupStatus.Ok, tournamentId: TournamentId });
    } catch (err) {
      console.error("[Unsignup] Error:", err);
      return res.status(200).json({ status: UnsignupStatus.DatabaseError, tournamentId: TournamentId });
    }
  }
);

export default {
  App,
  DefaultAPI: "/api/v1",
};
